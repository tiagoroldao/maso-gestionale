import { DateTime } from 'luxon'
import Big from 'big.js'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import Customer from '#models/customer'
import Invoice, { type CompanySnapshot } from '#models/invoice'
import InvoiceSequence from '#models/invoice_sequence'
import InvoiceLine from '#models/invoice_line'
import Item from '#models/item'
import Job from '#models/job'
import Visit from '#models/visit'
import type User from '#models/user'
import VatCode from '#models/vat_code'
import StockLedger from '#stock/stock_ledger'
import VatDefaults from '#services/vat_defaults'
import { ADVANCE_DEDUCTED_SQL } from '#services/job_status'
import Charges from '#services/charges'
import Payments from '#services/payments'
import CreditNoteNumbering, { NUMBERING_LOCK_KEY } from '#services/credit_note_numbering'
import type { LiquidationStatus, SoleShareholder } from '#shared/company'
import { invoiceLineTotal, invoiceTotals } from '#shared/invoice_totals'
import { lineTotal, splitAmount } from '#shared/money'
import { advanceLeft, deductionRows } from '#shared/advances'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'
import { CHARGE_DESCRIPTION_MAX } from '#shared/charges'
import { owed } from '#shared/payment_status'
import {
  creditRefusal,
  credits,
  exceedsCredit,
  type CreditRefusal,
  type NumberingSeries,
} from '#shared/credit_notes'
import {
  canTransition,
  isDeletable,
  isEditable,
  transition,
  type InvoiceStatus,
} from '#shared/invoice_lifecycle'

/**
 * The Invoice's status doesn't allow the change: only drafts and rejected
 * Invoices are edited, only drafts deleted or finalised.
 */
export class InvoiceNotEditableError extends Error {}

/**
 * The draft can't be finalised (or the deductions saved) yet: it has no
 * lines, the company details an invoice must carry are missing from
 * Company settings, its total is below zero, it takes back more of an
 * advance than is left, an advance corrected below what issued
 * Invoices already took back of it, or an advance for a Job since closed.
 * A Credit Note can't credit more than is left of its Invoice's total
 * after its other Credit Notes (`creditTooLarge`), and each of its lines
 * credits a line of that Invoice (`uncreditedLine`).
 */
export class InvoiceNotFinalisableError extends Error {
  constructor(
    readonly reason:
      | 'empty'
      | 'companyIncomplete'
      | 'negativeTotal'
      | 'deductionTooLarge'
      | 'belowDeducted'
      | 'jobClosed'
      | 'creditTooLarge'
      | 'uncreditedLine'
  ) {
    super(reason)
  }
}

/**
 * The Invoice can't be credited (see creditRefusal()).
 */
export class CreditNoteRefusedError extends Error {
  constructor(readonly reason: CreditRefusal) {
    super(reason)
  }
}

/**
 * How much of an Advance Invoice an Invoice takes back, VAT included.
 */
export type Deduction = { advanceId: number; amount: string }

/**
 * The Job has nothing to invoice yet (no Charge to bill on the Job or its
 * closed Visits), or, for an Advance Invoice, it is closed or cancelled.
 */
export class JobNotInvoiceableError extends Error {}

/**
 * The year's first Invoice is finalised, so its numbering is fixed.
 */
export class NumberingLockedError extends Error {}

export type InvoiceLineInput = {
  // An existing line of this Invoice, kept and updated (ADR 0010)
  id?: number
  itemId?: number
  unit?: string
  description: string
  quantity: string
  unitPrice: string
  discountPercent?: string
  vatCodeId: number
  // A deduction line, ignored: they follow the Invoice's deductions
  deductsInvoiceId?: number
  // The Charges the line bills, among those this Invoice's lines already
  // bill (to merge lines); a kept line sent without them keeps its own
  chargeIds?: number[]
  // On a Credit Note, the credited Invoice's line this line credits; a
  // kept line sent without it keeps its own
  creditsLineId?: number
}

/**
 * A line's link to a Charge it bills (or holds, on a draft), and since
 * when this Invoice has held the Charge.
 */
type Link = { lineId: number; chargeId: number; since: DateTime }

/**
 * Invoices: drafting, correcting after a Rejection, finalising and
 * deleting. Every change locks the Invoice and checks its lifecycle.
 */
export default class Invoices {
  static create(customer: Customer) {
    return Invoice.create({ customerId: customer.id, status: 'draft' })
  }

  /**
   * A draft Advance Invoice for part of a Job (FatturaPA TD02): one line
   * for Office to price, on the Job's default VAT for labour.
   */
  static async createAdvance(job: Job) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      // An advance is for work to come: none on a closed or cancelled Job
      if (!locked.isActive) throw new JobNotInvoiceableError()
      const { labour: code } = await VatDefaults.forJob(locked, trx)
      const invoice = await Invoice.create(
        { customerId: locked.customerId, jobId: locked.id, status: 'draft', advance: true },
        { client: trx }
      )
      await InvoiceLine.create(
        {
          invoiceId: invoice.id,
          position: 0,
          description: `Acconto – ${locked.number} ${locked.title}`,
          quantity: '1',
          unitPrice: '0',
          discountPercent: '0',
          vatCodeId: code.id,
          vatRate: code.rate,
          natura: code.natura,
          legalNote: code.legalNote,
          lineTotal: '0.00',
        },
        { client: trx }
      )
      return invoice
    })
  }

  /**
   * A draft Credit Note for an issued Invoice (FatturaPA TD04, ADR 0014),
   * with a line crediting each of the Invoice's lines in full and its
   * global discount, for Office to lower to what is credited. Refused for
   * an Invoice that can't be credited (creditRefusal()). While a draft
   * Credit Note for the Invoice is open it is returned instead of starting
   * another.
   */
  static async createCreditNote(invoice: Invoice) {
    return db.transaction(async (trx) => {
      const original = await this.lockCredited(trx, invoice.id)
      const refusal = creditRefusal(original)
      if (refusal) throw new CreditNoteRefusedError(refusal)
      const draft = await Invoice.query({ client: trx })
        .where('creditsInvoiceId', original.id)
        .where('status', 'draft')
        .first()
      if (draft) return draft

      const creditNote = await Invoice.create(
        {
          customerId: original.customerId,
          status: 'draft',
          documentType: 'credit_note',
          creditsInvoiceId: original.id,
          discountPercent: original.discountPercent,
        },
        { client: trx }
      )
      // Lines taking back an advance aren't credited here (#146)
      const lines = await InvoiceLine.query({ client: trx })
        .where('invoiceId', original.id)
        .whereNull('deductsInvoiceId')
        .orderBy('position')
      await InvoiceLine.createMany(
        lines.map((line, position) => ({
          invoiceId: creditNote.id,
          creditsLineId: line.id,
          position,
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          vatCodeId: line.vatCodeId,
          vatRate: line.vatRate,
          natura: line.natura,
          legalNote: line.legalNote,
          lineTotal: line.lineTotal,
        })),
        { client: trx }
      )
      return creditNote
    })
  }

  /**
   * Locks the Invoice `invoiceId` to credit it, after its Job (the order
   * whileIn() takes them), and returns it.
   */
  private static async lockCredited(trx: TransactionClientContract, invoiceId: number) {
    const row = await trx.from('invoices').where('id', invoiceId).select('job_id').first()
    if (row?.job_id) await trx.from('jobs').where('id', row.job_id).forUpdate().first()
    return Invoice.query({ client: trx }).where('id', invoiceId).forUpdate().firstOrFail()
  }

  /**
   * Refuses a Credit Note of `total` that would bring its Invoice's Credit
   * Notes above the Invoice's total, counting the others that credit
   * (credits()). Runs with the credited Invoice locked (whileIn()), so two
   * Credit Notes can't pass the check together.
   */
  private static async checkCredit(
    trx: TransactionClientContract,
    creditNote: Invoice,
    total: string
  ) {
    const original = await Invoice.query({ client: trx })
      .where('id', creditNote.creditsInvoiceId!)
      .firstOrFail()
    // All that credits the Invoice, less this Credit Note as stored when it
    // already counts (a rejected one being corrected)
    const own = await trx
      .from('invoices')
      .where('id', creditNote.id)
      .select('status', 'total')
      .firstOrFail()
    const others = new Big(await Payments.credited(trx, original.id)).minus(
      credits(own.status) ? own.total : 0
    )
    if (exceedsCredit(total, original.total!, others.toFixed(2))) {
      throw new InvoiceNotFinalisableError('creditTooLarge')
    }
  }

  /**
   * The Job's issued Advance Invoices (lines preloaded), each with what is
   * left to take back, VAT included, and the taxable already taken back
   * per VAT row, counting issued Invoices other than `except` (ADR 0011).
   * When writing, runs with the Job locked, which every Invoice change
   * takes first.
   */
  static async advancesOf(
    client: TransactionClientContract | undefined,
    jobId: number,
    except: number | null = null
  ) {
    const query = client ?? db
    const advances = await Invoice.query({ client })
      .where('jobId', jobId)
      .where('advance', true)
      .whereNot('status', 'draft')
      .preload('lines', (lines) => lines.orderBy('position'))
      .orderBy('id')
    const ids = advances.map((advance) => advance.id)
    const issuedOthers = (builder: any) =>
      builder.whereNot('di.status', 'draft').whereNot('di.id', except ?? 0)
    const amounts = ids.length
      ? await issuedOthers(
          query
            .from('advance_deductions as ad')
            .join('invoices as di', 'di.id', 'ad.invoice_id')
            .whereIn('ad.advance_id', ids)
        )
          .groupBy('ad.advance_id')
          .select('ad.advance_id')
          .sum('ad.amount as amount')
      : []
    const rows = ids.length
      ? await issuedOthers(
          query
            .from('invoice_lines as l')
            .join('invoices as di', 'di.id', 'l.invoice_id')
            .whereIn('l.deducts_invoice_id', ids)
        )
          .groupBy('l.deducts_invoice_id', 'l.vat_rate', 'l.natura')
          .select('l.deducts_invoice_id', 'l.vat_rate', 'l.natura')
          .sum('l.line_total as total')
      : []
    return advances.map((advance) => {
      const deducted = amounts.find((row: any) => row.advance_id === advance.id)?.amount ?? '0'
      return {
        advance,
        deducted: new Big(deducted).toFixed(2),
        left: advanceLeft(advance.total!, deducted),
        taken: rows
          .filter((row: any) => row.deducts_invoice_id === advance.id)
          .map((row: any) => ({
            vatRate: row.vat_rate as string,
            natura: row.natura as string | null,
            taxable: new Big(row.total).neg().toFixed(2),
          })),
      }
    })
  }

  /**
   * What a draft that bills everything outstanding takes back: what is
   * left of each advance.
   */
  private static async allLeft(trx: TransactionClientContract, jobId: number) {
    const open = await this.advancesOf(trx, jobId)
    return open
      .filter(({ left }) => new Big(left).gt(0))
      .map(({ advance, left }) => ({ advanceId: advance.id, amount: left }))
  }

  /**
   * The Invoice's deductions as saved.
   */
  private static async deductionsOf(trx: TransactionClientContract, invoiceId: number) {
    const rows = await trx
      .from('advance_deductions')
      .where('invoice_id', invoiceId)
      .orderBy('advance_id')
    return rows.map((row) => ({
      advanceId: row.advance_id as number,
      amount: row.amount as string,
    }))
  }

  /**
   * Writes what the Invoice takes back of each advance (ADR 0011) and its
   * deduction lines, after its other lines: one negative line per advance
   * and VAT row, naming the advance (deductionRows()). An amount can't be
   * more than what is left of its advance; advances not of the Job or not
   * issued are ignored. Lines kept from before keep
   * their identity. Runs with the Job locked.
   */
  private static async deduct(
    trx: TransactionClientContract,
    invoice: Invoice,
    wanted: Deduction[],
    firstPosition: number
  ) {
    const open =
      invoice.jobId && !invoice.advance ? await this.advancesOf(trx, invoice.jobId, invoice.id) : []
    const deductions = new Map<number, string>()
    for (const { advanceId, amount } of wanted) {
      const advance = open.find((entry) => entry.advance.id === advanceId)
      if (!advance || deductions.has(advanceId) || !new Big(amount).gt(0)) continue
      if (new Big(amount).gt(advance.left)) {
        throw new InvoiceNotFinalisableError('deductionTooLarge')
      }
      deductions.set(advanceId, new Big(amount).toFixed(2))
    }

    await trx.from('advance_deductions').where('invoice_id', invoice.id).delete()
    if (deductions.size) {
      await trx
        .insertQuery()
        .table('advance_deductions')
        .multiInsert(
          [...deductions].map(([advanceId, amount]) => ({
            invoice_id: invoice.id,
            advance_id: advanceId,
            amount,
            created_at: new Date(),
          }))
        )
    }

    const values = open.flatMap(({ advance, left, taken }) => {
      const amount = deductions.get(advance.id)
      if (!amount) return []
      const label = `Detrazione acconto fattura ${advance.formattedNumber} del ${advance.issuedOn!.toFormat('dd/MM/yyyy')}`
      return deductionRows(advance.totals.summary, amount, left, taken)
        .filter((row) => !new Big(row.taxable).eq(0))
        .map((row) => {
          // The VAT Code of a line in that row, copied as the advance had it
          const source = advance.lines.find(
            (line) => Number(line.vatRate) === Number(row.vatRate) && line.natura === row.natura
          )!
          const unitPrice = new Big(row.taxable).neg().toFixed(2)
          return {
            invoiceId: invoice.id,
            deductsInvoiceId: advance.id,
            description: label,
            quantity: '1',
            unit: null,
            unitPrice,
            discountPercent: '0',
            vatCodeId: source.vatCodeId,
            vatRate: source.vatRate,
            natura: source.natura,
            legalNote: source.legalNote,
            lineTotal: invoiceLineTotal('1', unitPrice),
          }
        })
    })
    const existing = await InvoiceLine.query({ client: trx })
      .where('invoiceId', invoice.id)
      .whereNotNull('deductsInvoiceId')
      .orderBy('position')
    const key = (line: {
      deductsInvoiceId: number | null
      vatRate: string
      natura: string | null
    }) => `${line.deductsInvoiceId}|${new Big(line.vatRate).toFixed(2)}|${line.natura ?? ''}`
    const kept = new Set<number>()
    for (const [index, value] of values.entries()) {
      const position = firstPosition + index
      const current = existing.find((line) => !kept.has(line.id) && key(line) === key(value))
      if (current) {
        kept.add(current.id)
        await current
          .useTransaction(trx)
          .merge({ ...value, position })
          .save()
      } else {
        await InvoiceLine.create({ ...value, position }, { client: trx })
      }
    }
    const removed = existing.filter((line) => !kept.has(line.id)).map((line) => line.id)
    if (removed.length) await InvoiceLine.query({ client: trx }).whereIn('id', removed).delete()
    return deductions.size > 0
  }

  /**
   * A draft Invoice for a Job, from its Charges, whether or not it has a
   * Quote (ADR 0012): one line per Charge to bill on its closed Visits and
   * on the Job itself, with what Office set
   * to bill (quantity, price, description; ADR 0010), so its total before
   * VAT equals the Job page's running total. Each line gets the VAT Code
   * of the default rules for its kind (labour, material or significant
   * good), and holds its Charge: finalising bills it, removing the line or
   * deleting the draft releases it. While a draft is open it is returned
   * instead of starting another.
   */
  static async fromJob(job: Job) {
    return db.transaction(async (trx) => {
      // Recorded work is billed whatever the Job's status (#111)
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      const draft = await Invoice.query({ client: trx })
        .where('jobId', locked.id)
        .where('status', 'draft')
        .where('advance', false)
        .first()
      if (draft) return draft

      // Closed Visits' Charges are final in the field; Office's edits and
      // other drafts wait on the Job lock
      const visits = await Visit.query({ client: trx })
        .where('jobId', locked.id)
        .whereIn('status', [...CLOSED_VISIT_STATUSES])
        .preload('charges', (charges) =>
          charges
            .withScopes((scopes) => scopes.toBill())
            .preload('item')
            .orderByRaw("kind = 'item', created_at, id")
        )
        .orderBy('startsAt')
      const onJob = await Charge.query({ client: trx })
        .withScopes((scopes) => scopes.toBill())
        .where('jobId', locked.id)
        .whereNull('visitId')
        .preload('item')
        .orderBy(['createdAt', 'id'])
      const work = [
        ...visits.flatMap((visit) =>
          visit.charges.map((charge) => ({ day: visit.startsAt.toFormat('dd/MM'), charge }))
        ),
        ...onJob.map((charge) => ({ day: null, charge })),
      ]
      if (!work.length) throw new JobNotInvoiceableError()

      const defaults = await VatDefaults.forJob(locked, trx)
      // Imported Quote lines bill at the VAT Code the Customer accepted,
      // unless it was archived since (ADR 0012)
      const quotedIds = work.flatMap(({ charge }) => (charge.vatCodeId ? [charge.vatCodeId] : []))
      const quoted = quotedIds.length
        ? await VatCode.query({ client: trx })
            .whereIn('id', quotedIds)
            .withScopes((scopes) => scopes.active())
        : []
      const codeOf = (charge: Charge) =>
        quoted.find((code) => code.id === charge.vatCodeId) ?? defaults[charge.lineKind]

      const invoice = await Invoice.create(
        { customerId: locked.customerId, jobId: locked.id, status: 'draft' },
        { client: trx }
      )
      const lines = await InvoiceLine.createMany(
        work.map(({ day, charge }, position) => {
          const code = codeOf(charge)
          // The Visit's day fits after the description on the line
          const suffix = day ? ` (${day})` : ''
          return {
            invoiceId: invoice.id,
            position,
            itemId: charge.itemId,
            description:
              charge.description.slice(0, CHARGE_DESCRIPTION_MAX - suffix.length) + suffix,
            quantity: charge.billQuantity,
            unit: charge.billUnit,
            unitPrice: charge.unitPrice,
            discountPercent: '0',
            vatCodeId: code.id,
            vatRate: code.rate,
            natura: code.natura,
            legalNote: code.legalNote,
            lineTotal: invoiceLineTotal(charge.billQuantity, charge.unitPrice),
          }
        }),
        { client: trx }
      )
      await this.hold(
        trx,
        lines.map((line, index) => ({ lineId: line.id, chargeId: work[index].charge.id }))
      )
      // A draft that bills everything outstanding (no Visit still to come)
      // takes back what is left of each advance; others start with none,
      // and Office can change both (ADR 0011)
      const moreWork = await Visit.query({ client: trx })
        .where('jobId', locked.id)
        .whereIn('status', ['planned', 'in_progress'])
        .first()
      if (!moreWork) {
        await this.deduct(trx, invoice, await this.allLeft(trx, locked.id), work.length)
      }
      return invoice
    })
  }

  /**
   * Saves the lines of a draft, or of a rejected Invoice being corrected
   * (which keeps its number and date): lines sent back with their id are
   * updated, the others removed and new ones added, copying each VAT
   * Code's rate and Natura and each Item's unit onto the line. Lines keep
   * the Charges they bill (see relink); deduction lines follow what the
   * Invoice takes back of each advance (see deduct). A rejected Invoice
   * already took its Items off stock, so the difference is booked in the
   * stock. A correction below what has been paid is saved and the Invoice
   * becomes overpaid (ADR 0014): `belowPaid` then holds what was paid, to
   * warn about it.
   */
  static async save(
    invoice: Invoice,
    input: {
      discountPercent?: string
      notes?: string | null
      lines: InvoiceLineInput[]
      // What the Invoice takes back of each advance; kept as is when left out
      deductions?: Deduction[]
    },
    user: User | null = null
  ): Promise<{ belowPaid: string | null; creditedOverpaidBy: string | null }> {
    return this.whileIn(isEditable, invoice, async (trx, locked) => {
      let belowPaid: string | null = null
      let creditedOverpaidBy: string | null = null
      // A prepared Submission's file may already be on SDI: no changes under it
      const open = await trx
        .from('invoice_submissions')
        .where('invoice_id', locked.id)
        .whereNull('outcome')
        .first()
      if (open) throw new InvoiceNotEditableError()

      // Only Invoices without a Job move stock (see finalise)
      const soldBefore =
        locked.status === 'rejected' && this.movesStock(locked)
          ? await this.itemsSold(trx, locked.id)
          : null
      if (locked.status === 'rejected') {
        // Rejections are often about the parties' data (a VAT number, the
        // recipient code): the correction takes the current Customer and
        // company, and keeps the number, dates and payment terms
        const issuer = this.companySnapshot(await CompanySettings.current())
        if (!issuer) throw new InvoiceNotFinalisableError('companyIncomplete')
        const customer = await Customer.findOrFail(locked.customerId, { client: trx })
        locked.merge({
          customerSnapshot: customer.toSnapshot(),
          companySnapshot: issuer,
        })
      }
      locked.merge({ discountPercent: input.discountPercent ?? '0', notes: input.notes ?? null })
      await locked.save()

      // Deduction lines follow the deductions (see deduct)
      const entries = input.lines.filter((line) => !line.deductsInvoiceId)
      const codes = await VatCode.query({ client: trx }).whereIn(
        'id',
        entries.map((line) => line.vatCodeId)
      )
      const vat = new Map(codes.map((code) => [code.id, code]))
      const itemIds = entries.flatMap((line) => (line.itemId ? [line.itemId] : []))
      const items = itemIds.length ? await Item.query({ client: trx }).whereIn('id', itemIds) : []
      const units = new Map(items.map((item) => [item.id, item.unit]))

      // Lines keep their identity across saves: the ones sent back are
      // updated, the others removed, and lines without an id added
      const existing = await InvoiceLine.query({ client: trx })
        .where('invoiceId', locked.id)
        .whereNull('deductsInvoiceId')
      const byId = new Map(existing.map((line) => [line.id, line]))
      // A Credit Note's lines each credit a line of its Invoice, other than
      // one taking back an advance
      const creditedLines = locked.isCreditNote
        ? await InvoiceLine.query({ client: trx })
            .where('invoiceId', locked.creditsInvoiceId!)
            .whereNull('deductsInvoiceId')
        : null
      const creditable = creditedLines
        ? new Map(creditedLines.map((line) => [line.id, line]))
        : null
      const creditedLineOf = (line: InvoiceLineInput) => {
        if (!creditable) return null
        const id = line.creditsLineId ?? (line.id ? byId.get(line.id)?.creditsLineId : null)
        const credited = id ? creditable.get(id) : undefined
        if (!credited) throw new InvoiceNotFinalisableError('uncreditedLine')
        return credited
      }
      const values = entries.map((line, position) => {
        const credited = creditedLineOf(line)
        // A Credit Note reverses VAT as the Invoice charged it, whatever
        // the request says and whatever the VAT Code says now
        const code = credited
          ? {
              id: credited.vatCodeId,
              rate: credited.vatRate,
              natura: credited.natura,
              legalNote: credited.legalNote,
            }
          : vat.get(line.vatCodeId)!
        const discountPercent = line.discountPercent ?? '0'
        return {
          invoiceId: locked.id,
          creditsLineId: credited?.id ?? null,
          position,
          itemId: line.itemId ?? null,
          description: line.description,
          quantity: line.quantity,
          // An Item's own unit; otherwise what the line carried (e.g. "h")
          unit: line.itemId ? (units.get(line.itemId) ?? null) : (line.unit ?? null),
          unitPrice: line.unitPrice,
          discountPercent,
          vatCodeId: code.id,
          vatRate: code.rate,
          natura: code.natura,
          legalNote: code.legalNote,
          lineTotal: invoiceLineTotal(line.quantity, line.unitPrice, discountPercent),
        }
      })
      const kept = new Set<number>()
      const updates: [InvoiceLine, (typeof values)[number]][] = []
      const additions: (typeof values)[number][] = []
      // Each line as saved: an existing one, or the index of a new one
      const saved: (InvoiceLine | number)[] = []
      entries.forEach((line, index) => {
        const current = line.id ? byId.get(line.id) : undefined
        // An id sent twice, or not of this Invoice, is a new line
        if (current && !kept.has(current.id)) {
          kept.add(current.id)
          updates.push([current, values[index]])
          saved.push(current)
        } else {
          saved.push(additions.length)
          additions.push(values[index])
        }
      })
      const links = await this.links(trx, locked.id)
      await InvoiceLine.query({ client: trx })
        .where('invoiceId', locked.id)
        .whereNull('deductsInvoiceId')
        .whereNotIn('id', [...kept])
        .delete()
      for (const [line, value] of updates) {
        await line.useTransaction(trx).merge(value).save()
      }
      const added = await InvoiceLine.createMany(additions, { client: trx })
      await this.relink(
        trx,
        locked,
        links,
        entries.map((line, index) => {
          const entry = saved[index]
          const lineId = typeof entry === 'number' ? added[entry].id : entry.id
          // Kept lines keep their Charges unless sent with others (deduction
          // lines, left out of `entries`, bill none)
          const chargeIds =
            line.chargeIds ??
            (typeof entry === 'number'
              ? []
              : links.filter((link) => link.lineId === entry.id).map((link) => link.chargeId))
          return { lineId, chargeIds }
        }),
        user
      )
      // Kept as they were unless sent; never more than is left of an advance
      const deducts = await this.deduct(
        trx,
        locked,
        input.deductions ?? (await this.deductionsOf(trx, locked.id)),
        entries.length
      )
      const lines = await InvoiceLine.query({ client: trx }).where('invoiceId', locked.id)
      const total = new Big(this.totalOf(lines, locked.discountPercent))
      // Taking advances back can't bring the total below zero
      if (deducts && total.lt(0)) throw new InvoiceNotFinalisableError('negativeTotal')
      // Drafts too, so Office learns early what is left to credit
      if (locked.isCreditNote) await this.checkCredit(trx, locked, total.toFixed(2))

      // A corrected Invoice's total changes with its lines; it must still
      // be one that could be issued
      if (locked.status !== 'draft') {
        locked.total = total.toFixed(2)
        if (total.lt(0)) throw new InvoiceNotFinalisableError('negativeTotal')
        // An advance can't be corrected below what issued Invoices took back
        if (locked.advance) {
          const taken = await trx.rawQuery(
            `SELECT ${ADVANCE_DEDUCTED_SQL('a')} AS taken
            FROM invoices a WHERE a.id = ?`,
            [locked.id]
          )
          if (total.lt(taken.rows[0].taken)) {
            throw new InvoiceNotFinalisableError('belowDeducted')
          }
        }
        // Payments are recorded with this Invoice locked: the sum is current.
        // Below it, the Invoice is overpaid: warned about, not refused
        if (!locked.isCreditNote) {
          const paid = await Payments.paid(trx, locked.id)
          const credited = await Payments.credited(trx, locked.id)
          if (new Big(owed({ total: locked.total, credited, paid })).lt(0)) belowPaid = paid
        }
        await locked.save()
        // A corrected Credit Note may leave its Invoice overpaid: warned
        // about, as when finalising one
        if (locked.isCreditNote) {
          creditedOverpaidBy = await this.overpaidBy(trx, locked.creditsInvoiceId!)
        }
      }

      if (soldBefore) {
        await this.rebookSale(trx, locked, soldBefore, await this.itemsSold(trx, locked.id), user)
      }
      return { belowPaid, creditedOverpaidBy }
    })
  }

  /**
   * How much the Invoice `invoiceId` is overpaid by after its Credit Notes
   * and Payments, read in `trx`; null when it isn't.
   */
  static async overpaidBy(trx: TransactionClientContract, invoiceId: number) {
    const invoice = await Invoice.query({ client: trx }).where('id', invoiceId).firstOrFail()
    const left = new Big(
      owed({
        total: invoice.total!,
        credited: await Payments.credited(trx, invoiceId),
        paid: await Payments.paid(trx, invoiceId),
      })
    )
    return left.lt(0) ? left.abs().toFixed(2) : null
  }

  /**
   * The grand total of a set of lines, as the Invoice shows it.
   */
  private static totalOf(lines: InvoiceLine[], discountPercent: string) {
    return invoiceTotals(
      lines.map((line) => line.totalsLine),
      discountPercent
    ).total
  }

  /**
   * Quantity of each Item on the Invoice's lines.
   */
  private static async itemsSold(trx: TransactionClientContract, invoiceId: number) {
    const lines = await InvoiceLine.query({ client: trx })
      .where('invoiceId', invoiceId)
      .whereNotNull('itemId')
    const sold = new Map<number, Big>()
    for (const line of lines) {
      sold.set(line.itemId!, (sold.get(line.itemId!) ?? new Big(0)).plus(line.quantity))
    }
    return sold
  }

  /**
   * Books in the stock what a corrected (rejected) Invoice now sells
   * compared with before: more sold is a sale, less sold comes back as an
   * adjustment. The ledger is never rewritten.
   */
  private static async rebookSale(
    trx: TransactionClientContract,
    invoice: Invoice,
    before: Map<number, Big>,
    after: Map<number, Big>,
    user: User | null
  ) {
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)
    if (!ids.length) return
    const items = await Item.query({ client: trx }).whereIn('id', ids).orderBy('id').forUpdate()
    const today = DateTime.now().startOf('day')
    for (const item of items) {
      const change = (after.get(item.id) ?? new Big(0)).minus(before.get(item.id) ?? new Big(0))
      if (change.eq(0)) continue
      const common = { occurredOn: today, reference: invoice.formattedNumber, user, client: trx }
      if (change.gt(0)) {
        await StockLedger.sell(item, { ...common, quantity: change.toFixed() })
      } else {
        await StockLedger.adjust(item, {
          ...common,
          quantity: change.neg().toFixed(),
          reason: `Fattura ${invoice.formattedNumber} corretta dopo lo scarto`,
        })
      }
    }
  }

  /**
   * Makes the draft a fiscal document: takes the year's next number and
   * today's date, works out the due date from the Customer's Payment
   * Terms, copies the Customer and company onto it, and takes Items sold
   * off stock. All in one transaction, with the year's sequence locked so
   * concurrent finalising can't skip or repeat a number.
   */
  static async finalise(invoice: Invoice, user: User | null = null) {
    const finalisable = (status: InvoiceStatus) => canTransition(status, 'finalise')
    return this.whileIn(finalisable, invoice, async (trx, locked) => {
      // An advance is for work to come: not once its Job is closed or
      // cancelled, as when drafting one (the Job is locked by whileIn)
      if (locked.advance) {
        const job = await Job.findOrFail(locked.jobId, { client: trx })
        if (!job.isActive) throw new InvoiceNotFinalisableError('jobClosed')
      }
      // Issued Invoices may have taken advances back since the draft was
      // saved: its deductions must still fit, their lines as they are now
      const regular = await InvoiceLine.query({ client: trx })
        .where('invoiceId', locked.id)
        .whereNull('deductsInvoiceId')
      await this.deduct(trx, locked, await this.deductionsOf(trx, locked.id), regular.length)
      const lines = await InvoiceLine.query({ client: trx })
        .where('invoiceId', locked.id)
        .orderBy('position')
      if (!lines.length) throw new InvoiceNotFinalisableError('empty')
      const total = new Big(this.totalOf(lines, locked.discountPercent))
      if (total.lt(0)) throw new InvoiceNotFinalisableError('negativeTotal')
      // An advance of nothing would only add empty deduction lines; a
      // Credit Note of nothing credits nothing
      if ((locked.advance || locked.isCreditNote) && total.eq(0)) {
        throw new InvoiceNotFinalisableError('empty')
      }
      // Other Credit Notes may have been finalised since this one was saved
      if (locked.isCreditNote) await this.checkCredit(trx, locked, total.toFixed(2))
      const issuer = this.companySnapshot(await CompanySettings.current())
      if (!issuer) throw new InvoiceNotFinalisableError('companyIncomplete')
      const customer = await Customer.query({ client: trx })
        .where('id', locked.customerId)
        .preload('paymentTerms')
        .firstOrFail()

      // Dated after the lock, so a later number never gets an earlier date
      // than one finalised while this one waited, and the year always
      // matches the date (even at midnight on 31 December)
      await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [NUMBERING_LOCK_KEY])
      const today = DateTime.now().startOf('day')
      // A Credit Note's series is the year's setting; nothing is paid on it
      const series = locked.isCreditNote
        ? await CreditNoteNumbering.seriesFor(trx, today.year)
        : 'invoice'
      locked.merge({
        status: transition(locked.status, 'finalise'),
        total: this.totalOf(lines, locked.discountPercent),
        year: today.year,
        series,
        number: await this.takeNumber(trx, today.year, series),
        issuedOn: today,
        dueOn: locked.isCreditNote ? null : customer.paymentTerms.dueDate(today),
        paymentMethod: locked.isCreditNote ? null : customer.paymentTerms.paymentMethod,
        customerSnapshot: customer.toSnapshot(),
        companySnapshot: issuer,
        finalisedAt: DateTime.now(),
      })
      await locked.save()

      // The Charges the draft held are billed now, each with its part of
      // its line's amount
      for (const [chargeId, share] of await this.shares(trx, locked.id)) {
        await ChargeEvent.create(
          {
            chargeId,
            kind: 'billed',
            userId: user?.id ?? null,
            invoiceId: locked.id,
            invoiceLineId: share.lineId,
            amount: share.amount,
          },
          { client: trx }
        )
      }

      // Items sold without a Job leave the Warehouse now (a Job's Items left
      // through its Visits); locked in id order so two Invoices sharing
      // Items can't deadlock
      const sold = this.movesStock(locked) ? lines.filter((line) => line.itemId) : []
      const ids = [...new Set(sold.map((line) => line.itemId!))].sort((a, b) => a - b)
      const items = ids.length
        ? await Item.query({ client: trx }).whereIn('id', ids).orderBy('id').forUpdate()
        : []
      const byId = new Map(items.map((item) => [item.id, item]))
      for (const line of sold) {
        await StockLedger.sell(byId.get(line.itemId!)!, {
          quantity: line.quantity,
          occurredOn: today,
          reference: locked.formattedNumber,
          user,
          client: trx,
        })
      }
      return locked
    })
  }

  /**
   * Where the year's Invoice numbering stands: the next number, and
   * whether it can still be changed (no number taken from it that year
   * yet, Credit Notes sharing it included).
   */
  static async numbering(year: number) {
    const sequence = await InvoiceSequence.query()
      .where('series', 'invoice')
      .where('year', year)
      .first()
    const issued = await Invoice.query().where('series', 'invoice').where('year', year).first()
    return { year, nextNumber: sequence?.nextNumber ?? 1, locked: Boolean(issued) }
  }

  /**
   * Sets where the year's Invoice numbering starts, e.g. to continue from
   * the old accounting software. Refused once the year has a number taken.
   */
  static async setNextNumber(year: number, nextNumber: number) {
    await db.transaction(async (trx) => {
      const sequence = await this.lockedSequence(trx, year, 'invoice')
      const issued = await Invoice.query({ client: trx })
        .where('series', 'invoice')
        .where('year', year)
        .first()
      if (issued) throw new NumberingLockedError()
      sequence.nextNumber = nextNumber
      await sequence.save()
    })
  }

  private static async lockedSequence(
    trx: TransactionClientContract,
    year: number,
    series: NumberingSeries
  ) {
    await trx
      .insertQuery()
      .table('invoice_sequences')
      .insert({ series, year, next_number: 1, created_at: new Date() })
      .onConflict(['series', 'year'])
      .ignore()
    const sequence = await InvoiceSequence.query({ client: trx })
      .where('series', series)
      .where('year', year)
      .forUpdate()
      .firstOrFail()
    return sequence.useTransaction(trx)
  }

  private static async takeNumber(
    trx: TransactionClientContract,
    year: number,
    series: NumberingSeries
  ) {
    const sequence = await this.lockedSequence(trx, year, series)
    const number = sequence.nextNumber
    sequence.nextNumber = number + 1
    await sequence.save()
    return number
  }

  /**
   * The issuer as an invoice needs it, or null while Company settings lack
   * what FatturaPA requires (name, Partita IVA, tax regime, address).
   */
  private static companySnapshot(company: CompanySettings): CompanySnapshot | null {
    const { name, vatNumber, taxRegime, street, postalCode, city, province } = company
    if (!name || !vatNumber || !taxRegime || !street || !postalCode || !city || !province) {
      return null
    }
    return {
      name,
      vatNumber,
      taxCode: company.taxCode,
      taxRegime,
      street,
      streetNumber: company.streetNumber,
      postalCode,
      city,
      province,
      email: company.email,
      phone: company.phone,
      iban: company.iban,
      rea:
        company.reaOffice && company.reaNumber
          ? {
              office: company.reaOffice,
              number: company.reaNumber,
              shareCapital: company.shareCapital,
              soleShareholder: company.soleShareholder as SoleShareholder | null,
              liquidationStatus: company.liquidationStatus as LiquidationStatus,
            }
          : null,
    }
  }

  /**
   * Deletes a draft, releasing the Charges it held.
   */
  static async destroy(invoice: Invoice) {
    await this.whileIn(isDeletable, invoice, async (trx, locked) => {
      const links = await this.links(trx, locked.id)
      await locked.delete()
      await Charges.release(
        trx,
        links.map((link) => ({ chargeId: link.chargeId, heldSince: link.since }))
      )
    })
  }

  /**
   * The Invoice's links between its lines and the Charges they bill.
   */
  private static async links(trx: TransactionClientContract, invoiceId: number): Promise<Link[]> {
    const rows = await trx
      .from('invoice_line_charges as lc')
      .join('invoice_lines as l', 'l.id', 'lc.invoice_line_id')
      .where('l.invoice_id', invoiceId)
      .select('lc.invoice_line_id', 'lc.charge_id', 'lc.created_at')
      .orderBy('lc.id')
    return rows.map((row) => ({
      lineId: row.invoice_line_id,
      chargeId: row.charge_id,
      since: DateTime.fromJSDate(row.created_at),
    }))
  }

  /**
   * Links lines to the Charges they bill (ADR 0010).
   */
  private static async hold(
    trx: TransactionClientContract,
    links: { lineId: number; chargeId: number; since?: DateTime }[]
  ) {
    if (!links.length) return
    await trx
      .insertQuery()
      .table('invoice_line_charges')
      .multiInsert(
        links.map((link) => ({
          invoice_line_id: link.lineId,
          charge_id: link.chargeId,
          created_at: (link.since ?? DateTime.now()).toJSDate(),
        }))
      )
  }

  /**
   * Puts the saved lines' Charges in place: each line bills the Charges
   * asked for among those the Invoice already had (each on one line only),
   * and the others are let go. A draft only held them, so they are just
   * released. On a rejected Invoice being corrected, a Charge it billed and
   * no longer does is set back to bill ("unbilled") and released, and one
   * whose line or part of the amount changed is billed again as corrected.
   */
  private static async relink(
    trx: TransactionClientContract,
    invoice: Invoice,
    before: Link[],
    wanted: { lineId: number; chargeIds: number[] }[],
    user: User | null
  ) {
    const had = new Map(before.map((link) => [link.chargeId, link]))
    const after = new Map<number, Link>()
    for (const { lineId, chargeIds } of wanted) {
      for (const chargeId of chargeIds) {
        const link = had.get(chargeId)
        if (link && !after.has(chargeId)) after.set(chargeId, { ...link, lineId })
      }
    }
    const lineIds = [...new Set(before.map((link) => link.lineId))]
    if (lineIds.length) {
      await trx.from('invoice_line_charges').whereIn('invoice_line_id', lineIds).delete()
    }
    await this.hold(trx, [...after.values()])
    const released = before.filter((link) => !after.has(link.chargeId))
    if (invoice.status === 'draft') {
      await Charges.release(
        trx,
        released.map((link) => ({ chargeId: link.chargeId, heldSince: link.since }))
      )
      return
    }

    // The Charges this Invoice bills now, as their latest billing says
    const billing = await ChargeEvent.query({ client: trx })
      .whereIn(
        'chargeId',
        before.map((link) => link.chargeId)
      )
      .whereIn('kind', ['billed', 'unbilled'])
      .orderBy('id')
    const latest = new Map(billing.map((event) => [event.chargeId, event]))
    const billedHere = (chargeId: number) => {
      const event = latest.get(chargeId)
      return event?.kind === 'billed' && event.invoiceId === invoice.id ? event : null
    }
    const event = (chargeId: number, values: Partial<ChargeEvent>) =>
      ChargeEvent.create(
        { chargeId, userId: user?.id ?? null, invoiceId: invoice.id, ...values },
        { client: trx }
      )
    const unbilled = released.filter((link) => billedHere(link.chargeId))
    for (const link of unbilled) await event(link.chargeId, { kind: 'unbilled' })
    await Charges.release(
      trx,
      unbilled.map((link) => ({ chargeId: link.chargeId, heldSince: link.since }))
    )
    for (const [chargeId, share] of await this.shares(trx, invoice.id)) {
      const current = billedHere(chargeId)
      if (!current) continue
      const same =
        current.invoiceLineId === share.lineId && new Big(current.amount!).eq(share.amount)
      if (same) continue
      await event(chargeId, { kind: 'billed', invoiceLineId: share.lineId, amount: share.amount })
    }
  }

  /**
   * Each Charge the Invoice's lines bill, with its line and its part of
   * the line's amount: a line billing several splits its amount in
   * proportion to their billing values, so the parts add up to it. The
   * Charges are locked (after the Job and the Invoice).
   */
  private static async shares(trx: TransactionClientContract, invoiceId: number) {
    const links = await this.links(trx, invoiceId)
    const charges = links.length
      ? await Charge.query({ client: trx })
          .whereIn(
            'id',
            links.map((link) => link.chargeId)
          )
          .orderBy('id')
          .forUpdate()
      : []
    const value = new Map(
      charges.map((charge) => [charge.id, lineTotal(charge.billQuantity, charge.unitPrice)])
    )
    const lines = await InvoiceLine.query({ client: trx })
      .whereIn(
        'id',
        links.map((link) => link.lineId)
      )
      .orderBy('position')
    const shares = new Map<number, { lineId: number; amount: string }>()
    for (const line of lines) {
      const billed = links.filter((link) => link.lineId === line.id)
      const parts = splitAmount(
        line.lineTotal,
        billed.map((link) => value.get(link.chargeId)!)
      )
      billed.forEach((link, index) => {
        shares.set(link.chargeId, { lineId: line.id, amount: parts[index] })
      })
    }
    return shares
  }

  /**
   * Whether finalising the Invoice takes its Items off stock: only an
   * Invoice without a Job (a Job's Items left through its Visits), never a
   * Credit Note.
   */
  private static movesStock(invoice: Invoice) {
    return !invoice.jobId && !invoice.isCreditNote
  }

  /**
   * Runs `work` with the Invoice's Job locked, then the Invoice locked and
   * re-read, refusing unless its status passes `allowed`. A Credit Note
   * first locks the Invoice it credits, after that Invoice's Job, so
   * checking what is left to credit sees the other Credit Notes as they
   * are.
   */
  private static whileIn<T>(
    allowed: (status: InvoiceStatus) => boolean,
    invoice: Invoice,
    work: (trx: TransactionClientContract, locked: Invoice) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      // The Job first, in the order drafting takes them (Job, then
      // Invoices, then their Charges)
      const row = await trx
        .from('invoices')
        .where('id', invoice.id)
        .select('job_id', 'credits_invoice_id')
        .first()
      if (row?.credits_invoice_id) await this.lockCredited(trx, row.credits_invoice_id)
      else if (row?.job_id) await trx.from('jobs').where('id', row.job_id).forUpdate().first()
      const locked = await Invoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      if (!allowed(locked.status)) throw new InvoiceNotEditableError()
      return work(trx, locked)
    })
  }
}
