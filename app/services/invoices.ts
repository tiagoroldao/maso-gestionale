import { DateTime } from 'luxon'
import Big from 'big.js'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import Charge from '#models/charge'
import Customer from '#models/customer'
import Invoice, { type CompanySnapshot, type CustomerSnapshot } from '#models/invoice'
import InvoiceSequence from '#models/invoice_sequence'
import InvoiceLine from '#models/invoice_line'
import Item from '#models/item'
import Job from '#models/job'
import Quote from '#models/quote'
import Visit from '#models/visit'
import type User from '#models/user'
import VatCode from '#models/vat_code'
import StockLedger from '#stock/stock_ledger'
import VatDefaults from '#services/vat_defaults'
import type { LiquidationStatus, SoleShareholder } from '#shared/company'
import { invoiceLineTotal, invoiceTotals } from '#shared/invoice_totals'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'
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
 * The correction would bring the Invoice's total below what has already
 * been paid on it.
 */
export class InvoiceBelowPaidError extends Error {
  constructor(readonly paid: string) {
    super(paid)
  }
}

/**
 * Serialises finalising across years, so the issue date and the year's
 * number come from one reading of the clock taken after the lock.
 */
const NUMBERING_LOCK_KEY = 4_190_419

/**
 * The draft can't be finalised yet: it has no lines, or the company
 * details an invoice must carry are missing from Company settings.
 */
export class InvoiceNotFinalisableError extends Error {
  constructor(
    readonly reason:
      'empty' | 'companyIncomplete' | 'negativeTotal' | 'deductionsChanged' | 'jobInvoiced'
  ) {
    super(reason)
  }
}

/**
 * The Job has nothing to invoice yet (no accepted Quote; no unbilled work
 * on closed Visits), or it was cancelled.
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
  // A deduction line keeps the Advance Invoice it takes back
  deductsInvoiceId?: number
}

/**
 * Invoices: drafting, correcting after a Rejection, finalising and
 * deleting. Every change locks the Invoice and checks its lifecycle.
 */
export default class Invoices {
  static create(customer: Customer) {
    return Invoice.create({ customerId: customer.id, status: 'draft' })
  }

  /**
   * A draft Invoice for a Job: from its accepted Quote, or from the time
   * and materials recorded on its Visits.
   */
  static fromJob(job: Job) {
    return job.kind === 'quoted' ? this.fromQuote(job) : this.fromTimeAndMaterials(job)
  }

  /**
   * A draft Advance Invoice for part of a Job (FatturaPA TD02): one line
   * for Office to price, on the Job's default VAT for labour.
   */
  static async createAdvance(job: Job) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      if (locked.status === 'cancelled') throw new JobNotInvoiceableError()
      // Once the Quote's Invoice exists, nothing could take an advance back
      if (locked.kind === 'quoted') {
        const own = await Invoice.query({ client: trx })
          .where('jobId', locked.id)
          .where('advance', false)
          .first()
        if (own) throw new JobNotInvoiceableError()
      }
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
   * Takes back the Job's issued Advance Invoices on its final Invoice: one
   * negative line per Advance Invoice and VAT treatment, for its taxable
   * amount, naming the Advance Invoice. Each is marked as deducted here,
   * and freed again if this draft is deleted. Runs with the Job locked.
   */
  private static async addDeductions(
    trx: TransactionClientContract,
    jobId: number,
    invoice: Invoice,
    firstPosition: number
  ) {
    const advances = await Invoice.query({ client: trx })
      .where('jobId', jobId)
      .where('advance', true)
      .whereNot('status', 'draft')
      .whereNull('deductedInId')
      .preload('lines', (lines) => lines.orderBy('position'))
      .orderBy('id')
      .forUpdate()
    let position = firstPosition
    for (const advance of advances) {
      const label = `Detrazione acconto fattura ${advance.formattedNumber} del ${advance.issuedOn!.toFormat('dd/MM/yyyy')}`
      for (const row of advance.totals.summary) {
        if (new Big(row.taxable).eq(0)) continue
        // The VAT Code of a line in that row, copied as the advance had it
        const source = advance.lines.find(
          (line) => Number(line.vatRate) === Number(row.vatRate) && line.natura === row.natura
        )!
        const unitPrice = new Big(row.taxable).neg().toFixed(2)
        await InvoiceLine.create(
          {
            invoiceId: invoice.id,
            position: position++,
            deductsInvoiceId: advance.id,
            description: label,
            quantity: '1',
            unitPrice,
            discountPercent: '0',
            vatCodeId: source.vatCodeId,
            vatRate: source.vatRate,
            natura: source.natura,
            legalNote: source.legalNote,
            lineTotal: invoiceLineTotal('1', unitPrice),
          },
          { client: trx }
        )
      }
      await Invoice.query({ client: trx })
        .where('id', advance.id)
        .update({ deducted_in_id: invoice.id })
    }
  }

  /**
   * A draft Invoice for a Time & Materials Job: one line per billable
   * Charge on its closed Visits and on the Job itself, with what Office
   * set to bill (quantity,
   * price, description; ADR 0010), so its total before VAT equals the Job
   * page's running total. Each line gets the VAT Code of the default rules
   * for its kind (labour, material or significant good). Only Charges not
   * yet billed go in, and are marked as billed by this Invoice; deleting
   * the draft frees them again. While a draft is open it is returned
   * instead of starting another.
   */
  static async fromTimeAndMaterials(job: Job) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      if (locked.kind !== 'time_and_materials' || locked.status === 'cancelled') {
        throw new JobNotInvoiceableError()
      }
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
            .withScopes((scopes) => scopes.billable())
            .whereNull('invoiceId')
            .preload('item')
            .orderByRaw("kind = 'item', created_at, id")
        )
        .orderBy('startsAt')
      const onJob = await Charge.query({ client: trx })
        .withScopes((scopes) => scopes.billable())
        .where('jobId', locked.id)
        .whereNull('visitId')
        .whereNull('invoiceId')
        .orderBy(['createdAt', 'id'])
      const work = [
        ...visits.flatMap((visit) =>
          visit.charges.map((charge) => ({ day: visit.startsAt.toFormat('dd/MM'), charge }))
        ),
        ...onJob.map((charge) => ({ day: null, charge })),
      ]
      if (!work.length) throw new JobNotInvoiceableError()

      const defaults = await VatDefaults.forJob(locked, trx)

      const invoice = await Invoice.create(
        { customerId: locked.customerId, jobId: locked.id, status: 'draft' },
        { client: trx }
      )
      await InvoiceLine.createMany(
        work.map(({ day, charge }, position) => {
          const code = defaults[charge.lineKind]
          return {
            invoiceId: invoice.id,
            position,
            itemId: charge.itemId,
            description: day ? `${charge.description} (${day})` : charge.description,
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
      await trx
        .from('charges')
        .whereIn(
          'id',
          work.map(({ charge }) => charge.id)
        )
        .update({ invoice_id: invoice.id })
      // The advances are taken back by the draft that bills the last of the
      // work: none while Visits are still to come
      const moreWork = await Visit.query({ client: trx })
        .where('jobId', locked.id)
        .whereIn('status', ['planned', 'in_progress'])
        .first()
      if (!moreWork) await this.addDeductions(trx, locked.id, invoice, work.length)
      return invoice
    })
  }

  /**
   * A draft Invoice for a Quoted Job, mirroring its accepted Quote: the
   * same prices and the VAT treatment the Customer accepted (copied from
   * the Quote's lines, not re-read from today's VAT Codes). Text lines and
   * the Quote's notes become the Invoice's notes. The Quote is invoiced
   * once: if the Job already has its Invoice (Advance Invoices don't
   * count), whatever its stage, that one is returned instead of a second.
   * Issued Advance Invoices are taken back on it.
   */
  static async fromQuote(job: Job) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      const quote = await Quote.query({ client: trx })
        .where('jobId', locked.id)
        .preload('lines', (lines) => lines.orderBy('position'))
        .first()
      if (
        locked.kind !== 'quoted' ||
        quote?.status !== 'accepted' ||
        locked.status === 'cancelled'
      ) {
        throw new JobNotInvoiceableError()
      }
      // The Quote is invoiced once; Advance Invoices are taken back on it
      const existing = await Invoice.query({ client: trx })
        .where('jobId', locked.id)
        .where('advance', false)
        .first()
      if (existing) return existing

      const texts = quote.lines.filter((line) => line.kind === 'text')
      const notes = [quote.notes, ...texts.map((line) => line.description)]
        .filter(Boolean)
        .join('\n')
      const invoice = await Invoice.create(
        { customerId: locked.customerId, jobId: locked.id, status: 'draft', notes: notes || null },
        { client: trx }
      )
      const priced = quote.lines.filter((line) => line.kind !== 'text')
      await InvoiceLine.createMany(
        priced.map((line, position) => ({
          invoiceId: invoice.id,
          position,
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity!,
          unit: line.unit,
          unitPrice: line.unitPrice!,
          discountPercent: '0',
          vatCodeId: line.vatCodeId!,
          vatRate: line.vatRate!,
          natura: line.natura,
          legalNote: line.legalNote,
          lineTotal: invoiceLineTotal(line.quantity!, line.unitPrice!),
        })),
        { client: trx }
      )
      await this.addDeductions(trx, locked.id, invoice, priced.length)
      return invoice
    })
  }

  /**
   * Saves the lines of a draft, or of a rejected Invoice being corrected
   * (which keeps its number and date): lines sent back with their id are
   * updated, the others removed and new ones added, copying each VAT
   * Code's rate and Natura and each Item's unit onto the line. A rejected
   * Invoice already took its Items off stock, so the difference is booked
   * in the stock.
   */
  static async save(
    invoice: Invoice,
    input: { discountPercent?: string; notes?: string | null; lines: InvoiceLineInput[] },
    user: User | null = null
  ) {
    await this.whileIn(isEditable, invoice, async (trx, locked) => {
      // A prepared Submission's file may already be on SDI: no changes under it
      const open = await trx
        .from('invoice_submissions')
        .where('invoice_id', locked.id)
        .whereNull('outcome')
        .first()
      if (open) throw new InvoiceNotEditableError()

      // Only Invoices without a Job move stock (see finalise)
      const soldBefore =
        locked.status === 'rejected' && !locked.jobId ? await this.itemsSold(trx, locked.id) : null
      if (locked.status === 'rejected') {
        // Rejections are often about the parties' data (a VAT number, the
        // recipient code): the correction takes the current Customer and
        // company, and keeps the number, dates and payment terms
        const issuer = this.companySnapshot(await CompanySettings.current())
        if (!issuer) throw new InvoiceNotFinalisableError('companyIncomplete')
        const customer = await Customer.findOrFail(locked.customerId, { client: trx })
        locked.merge({ customerSnapshot: this.customerSnapshot(customer), companySnapshot: issuer })
      }
      locked.merge({ discountPercent: input.discountPercent ?? '0', notes: input.notes ?? null })
      await locked.save()

      const codes = await VatCode.query({ client: trx }).whereIn(
        'id',
        input.lines.map((line) => line.vatCodeId)
      )
      const vat = new Map(codes.map((code) => [code.id, code]))
      const itemIds = input.lines.flatMap((line) => (line.itemId ? [line.itemId] : []))
      const items = itemIds.length ? await Item.query({ client: trx }).whereIn('id', itemIds) : []
      const units = new Map(items.map((item) => [item.id, item.unit]))

      // Only advances this Invoice takes back can have deduction lines
      const advances = await trx.from('invoices').where('deducted_in_id', locked.id).select('id')
      const deducted = new Set(advances.map((row) => row.id as number))

      // Lines keep their identity across saves: the ones sent back are
      // updated, the others removed, and lines without an id added
      const existing = await InvoiceLine.query({ client: trx }).where('invoiceId', locked.id)
      const byId = new Map(existing.map((line) => [line.id, line]))
      const values = input.lines.map((line, position) => {
        const code = vat.get(line.vatCodeId)!
        const discountPercent = line.discountPercent ?? '0'
        return {
          invoiceId: locked.id,
          position,
          itemId: line.itemId ?? null,
          deductsInvoiceId:
            line.deductsInvoiceId && deducted.has(line.deductsInvoiceId)
              ? line.deductsInvoiceId
              : null,
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
      input.lines.forEach((line, index) => {
        const current = line.id ? byId.get(line.id) : undefined
        // An id sent twice, or not of this Invoice, is a new line
        if (current && !kept.has(current.id)) {
          kept.add(current.id)
          updates.push([current, values[index]])
        } else {
          additions.push(values[index])
        }
      })
      await InvoiceLine.query({ client: trx })
        .where('invoiceId', locked.id)
        .whereNotIn('id', [...kept])
        .delete()
      for (const [line, value] of updates) {
        await line.useTransaction(trx).merge(value).save()
      }
      await InvoiceLine.createMany(additions, { client: trx })

      // A corrected Invoice's total changes with its lines; it must still
      // be one that could be issued
      if (locked.status !== 'draft') {
        const lines = await InvoiceLine.query({ client: trx }).where('invoiceId', locked.id)
        locked.total = this.totalOf(lines, locked.discountPercent)
        if (new Big(locked.total).lt(0)) throw new InvoiceNotFinalisableError('negativeTotal')
        await this.checkDeductions(trx, locked, lines)
        // Payments are recorded with this Invoice locked: the sum is current
        const paid = await trx
          .from('payments')
          .where('invoice_id', locked.id)
          .sum('amount as paid')
          .first()
        if (new Big(locked.total).lt(paid?.paid ?? 0)) throw new InvoiceBelowPaidError(paid.paid)
        await locked.save()
      }

      if (soldBefore) {
        await this.rebookSale(trx, locked, soldBefore, await this.itemsSold(trx, locked.id), user)
      }
    })
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
    return this.whileIn(
      finalisable,
      invoice,
      async (trx, locked) => {
        const lines = await InvoiceLine.query({ client: trx })
          .where('invoiceId', locked.id)
          .orderBy('position')
        if (!lines.length) throw new InvoiceNotFinalisableError('empty')
        const total = new Big(this.totalOf(lines, locked.discountPercent))
        if (total.lt(0)) throw new InvoiceNotFinalisableError('negativeTotal')
        // An advance of nothing would only add empty deduction lines
        if (locked.advance && total.eq(0)) throw new InvoiceNotFinalisableError('empty')
        await this.checkDeductions(trx, locked, lines)
        if (locked.advance) await this.checkAdvanceStillDeductible(trx, locked)
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
        locked.merge({
          status: transition(locked.status, 'finalise'),
          total: this.totalOf(lines, locked.discountPercent),
          year: today.year,
          number: await this.takeNumber(trx, today.year),
          issuedOn: today,
          dueOn: customer.paymentTerms.dueDate(today),
          paymentMethod: customer.paymentTerms.paymentMethod,
          customerSnapshot: this.customerSnapshot(customer),
          companySnapshot: issuer,
          finalisedAt: DateTime.now(),
        })
        await locked.save()

        // Items sold without a Job leave the Warehouse now (a Job's Items left
        // through its Visits); locked in id order so two Invoices sharing
        // Items can't deadlock
        const sold = locked.jobId ? [] : lines.filter((line) => line.itemId)
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
      },
      { lockJob: true }
    )
  }

  /**
   * Each advance this Invoice takes back must still be taken back in full
   * by its deduction lines (Office may have edited or removed them).
   */
  private static async checkDeductions(
    trx: TransactionClientContract,
    invoice: Invoice,
    lines: InvoiceLine[]
  ) {
    const advances = await Invoice.query({ client: trx })
      .where('deductedInId', invoice.id)
      .preload('lines')
    // Per advance and VAT treatment: moving a deduction to another rate
    // would hand back the wrong VAT
    const rowKey = (rate: string, natura: string | null) =>
      `${new Big(rate).toFixed(2)}|${natura ?? ''}`
    const deducted = (id: number) => {
      const rows = new Map<string, Big>()
      for (const line of lines.filter((l) => l.deductsInvoiceId === id)) {
        const key = rowKey(line.vatRate, line.natura)
        rows.set(key, (rows.get(key) ?? new Big(0)).plus(line.lineTotal))
      }
      return rows
    }
    const owed = (advance: Invoice) =>
      new Map(
        advance.totals.summary
          .filter((row) => !new Big(row.taxable).eq(0))
          .map((row) => [rowKey(row.vatRate, row.natura), new Big(row.taxable).neg()])
      )
    const sameRows = (a: Map<string, Big>, b: Map<string, Big>) =>
      a.size === b.size && [...a].every(([key, value]) => b.get(key)?.eq(value))
    const ids = new Set(advances.map((advance) => advance.id))
    const intact =
      lines.every((line) => line.deductsInvoiceId === null || ids.has(line.deductsInvoiceId)) &&
      advances.every((advance) => sameRows(deducted(advance.id), owed(advance)))
    if (!intact) throw new InvoiceNotFinalisableError('deductionsChanged')
  }

  /**
   * An advance issued now must be taken back by an Invoice still to come:
   * not once the Quote's Invoice exists, nor while a draft of the Job's
   * own Invoice waits (it was drafted without this advance).
   */
  private static async checkAdvanceStillDeductible(
    trx: TransactionClientContract,
    advance: Invoice
  ) {
    const job = await Job.query({ client: trx }).where('id', advance.jobId!).firstOrFail()
    const own = await Invoice.query({ client: trx })
      .where('jobId', job.id)
      .where('advance', false)
      .where((query) => {
        if (job.kind === 'time_and_materials') query.where('status', 'draft')
      })
      .first()
    if (own) throw new InvoiceNotFinalisableError('jobInvoiced')
  }

  /**
   * Where the year's numbering stands: the next number, and whether it can
   * still be changed (no Invoice finalised that year yet).
   */
  static async numbering(year: number) {
    const sequence = await InvoiceSequence.findBy('year', year)
    const issued = await Invoice.query().where('year', year).first()
    return { year, nextNumber: sequence?.nextNumber ?? 1, locked: Boolean(issued) }
  }

  /**
   * Sets where the year's numbering starts, e.g. to continue from the old
   * accounting software. Refused once the year has a finalised Invoice.
   */
  static async setNextNumber(year: number, nextNumber: number) {
    await db.transaction(async (trx) => {
      const sequence = await this.lockedSequence(trx, year)
      const issued = await Invoice.query({ client: trx }).where('year', year).first()
      if (issued) throw new NumberingLockedError()
      sequence.nextNumber = nextNumber
      await sequence.save()
    })
  }

  private static async lockedSequence(trx: TransactionClientContract, year: number) {
    await trx
      .insertQuery()
      .table('invoice_sequences')
      .insert({ year, next_number: 1, created_at: new Date() })
      .onConflict('year')
      .ignore()
    const sequence = await InvoiceSequence.query({ client: trx })
      .where('year', year)
      .forUpdate()
      .firstOrFail()
    return sequence.useTransaction(trx)
  }

  private static async takeNumber(trx: TransactionClientContract, year: number) {
    const sequence = await this.lockedSequence(trx, year)
    const number = sequence.nextNumber
    sequence.nextNumber = number + 1
    await sequence.save()
    return number
  }

  private static customerSnapshot(customer: Customer): CustomerSnapshot {
    return {
      type: customer.type,
      name: customer.displayName,
      firstName: customer.firstName,
      lastName: customer.lastName,
      vatNumber: customer.vatNumber,
      taxCode: customer.taxCode,
      sdiCode: customer.sdiCode,
      pec: customer.pec,
      street: customer.street,
      streetNumber: customer.streetNumber,
      postalCode: customer.postalCode,
      city: customer.city,
      province: customer.province,
    }
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

  static async destroy(invoice: Invoice) {
    await this.whileIn(isDeletable, invoice, (_, locked) => locked.delete())
  }

  /**
   * Runs `work` with the Invoice locked and re-read, refusing unless its
   * status passes `allowed`.
   */
  private static whileIn<T>(
    allowed: (status: InvoiceStatus) => boolean,
    invoice: Invoice,
    work: (trx: TransactionClientContract, locked: Invoice) => Promise<T>,
    { lockJob = false } = {}
  ) {
    return db.transaction(async (trx) => {
      // The Job first, in the order deductions take them (Job, then Invoices)
      if (lockJob) {
        const row = await trx.from('invoices').where('id', invoice.id).select('job_id').first()
        if (row?.job_id) await trx.from('jobs').where('id', row.job_id).forUpdate().first()
      }
      const locked = await Invoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      if (!allowed(locked.status)) throw new InvoiceNotEditableError()
      return work(trx, locked)
    })
  }
}
