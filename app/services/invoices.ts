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
import {
  ADVANCE_DEDUCTED_SQL,
  ADVANCE_TAKEN_BACK_SQL,
  DEDUCTION_REVERSED_SQL,
  OUTSTANDING_SQL,
  WORK_STATE_SQL,
} from '#services/job_status'
import Charges from '#services/charges'
import Payments from '#services/payments'
import CreditNoteNumbering, { NUMBERING_LOCK_KEY } from '#services/credit_note_numbering'
import type { LiquidationStatus, SoleShareholder } from '#shared/company'
import { invoiceLineTotal, invoiceTotals } from '#shared/invoice_totals'
import { lineTotal, splitAmount, sumAmounts } from '#shared/money'
import { advanceLeft, deductionRows } from '#shared/advances'
import { CLOSED_VISIT_STATUSES, OPEN_VISIT_STATUSES } from '#shared/visits'
import { BILLING_EVENT_KINDS, CHARGE_DESCRIPTION_MAX } from '#shared/charges'
import { owed } from '#shared/payment_status'
import {
  legacyCreditRefusal,
  legacyRowVat,
  type LegacyCreditRefusal,
} from '#shared/legacy_invoices'
import LegacyVatRow from '#models/legacy_vat_row'
import {
  creditedInFull,
  creditLeft,
  creditRefusal,
  credits,
  exceedsCredit,
  lineCreditRefusal,
  type CreditRefusal,
  type LineCreditRefusal,
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
 * after its other Credit Notes, nor of an advance more than is left to
 * take back (`creditTooLarge`); each of its lines credits a line of that
 * Invoice (`uncreditedLine`), never more than is left of it nor a
 * negative amount (lineCreditRefusal()); and it gives back all of a
 * deduction or none of it (`partialDeduction`). On a Legacy Invoice, its
 * lines credit amounts, as legacyCreditRefusal() says. Corrected after a
 * Rejection so it no longer gives a deduction back, the deduction must
 * still fit what is left of its advance (`deductionTooLarge`).
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
      | 'partialDeduction'
      | LineCreditRefusal
      | LegacyCreditRefusal
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
   * with its global discount and a line crediting what is left of each of
   * the Invoice's lines (all of it, unless earlier Credit Notes credited
   * some), for Office to lower to what is credited. A final Invoice's
   * deduction lines are copied as they are, giving the advances back
   * (Office removes them to leave the advances taken back); an advance's
   * lines credit only the share still left to take back of it. Refused
   * for an Invoice that can't be credited (creditRefusal()), or an advance
   * with nothing left (`advanceTakenBack`). While a draft Credit Note for
   * the Invoice is open it is returned instead of starting another.
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

      // An advance partly taken back: each line credits its share of what
      // is left (VAT included), rounded down, and lowered by the cent
      // where each VAT row's rounding would take it over (see below)
      let share: Big | null = null
      let advanceLeftToCredit: Big | null = null
      if (original.advance) {
        const deducted = await this.advanceDeducted(trx, original.id)
        const credited = await Payments.credited(trx, original.id)
        const left = new Big(advanceLeft(original.total!, deducted, credited))
        if (left.lte(0)) throw new CreditNoteRefusedError('advanceTakenBack')
        const notCredited = new Big(original.total!).minus(credited)
        if (left.lt(notCredited)) {
          share = left.div(notCredited)
          advanceLeftToCredit = left
        }
      }

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
      if (original.isLegacy) {
        const values = await this.legacyCreditLines(trx, original, creditNote.id)
        await InvoiceLine.createMany(values, { client: trx })
        return creditNote
      }
      const lines = await InvoiceLine.query({ client: trx })
        .where('invoiceId', original.id)
        .orderBy('position')
      const credited = await this.lineCredits(trx, original.id)
      const values = lines.flatMap((line) => {
        const copy = {
          invoiceId: creditNote.id,
          creditsLineId: line.id,
          deductsInvoiceId: line.deductsInvoiceId,
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
        }
        const done = credited.get(line.id)
        // A deduction is given back once, as it was
        if (line.deductsInvoiceId) return done ? [] : [copy]
        if (!done && !share) return [copy]
        const left = new Big(line.lineTotal).minus(done ?? 0)
        const amount = (share ? left.times(share).round(2, Big.roundDown) : left).toFixed(2)
        if (new Big(amount).lte(0)) return []
        return [
          { ...copy, quantity: '1', unitPrice: amount, discountPercent: '0', lineTotal: amount },
        ]
      })
      // Each VAT row's VAT rounds on its own, so the shares can add up to
      // a cent or two over what is left: take it off the largest lines
      if (advanceLeftToCredit) {
        const totalOf = () =>
          invoiceTotals(
            values.map((value) => ({ ...value, deduction: false })),
            original.discountPercent
          ).total
        while (values.length && new Big(totalOf()).gt(advanceLeftToCredit)) {
          const largest = values.reduce((max, value) =>
            new Big(value.lineTotal).gt(max.lineTotal) ? value : max
          )
          const lowered = new Big(largest.lineTotal).minus('0.01').toFixed(2)
          Object.assign(largest, { unitPrice: lowered, lineTotal: lowered })
        }
      }
      await InvoiceLine.createMany(
        values.map((value, position) => ({ ...value, position })),
        { client: trx }
      )
      return creditNote
    })
  }

  /**
   * A Credit Note's starting lines for a Legacy Invoice (#27), which has
   * no lines to copy, for Office to change:
   * - an advance: what is left of each VAT row (after deductions and other
   *   Credit Notes), at its VAT Code;
   * - otherwise: one line for what is left of the printed taxable and VAT,
   *   at the VAT Code whose rate gives its printed VAT; none when no active
   *   one does (an exempt or reverse-charge invoice: its Natura can't be
   *   told), and Office adds the lines.
   * When VAT rounding or a total printed below taxable plus VAT takes them
   * over what is left of the total, they are scaled down to it (what is
   * left divided by the lines' total, VAT included), then lowered by the
   * cent where each row's rounding still tips it over.
   */
  private static async legacyCreditLines(
    trx: TransactionClientContract,
    original: Invoice,
    creditNoteId: number
  ) {
    const label = `Storno fattura ${original.legacyNumber} del ${original.issuedOn!.toFormat('dd/MM/yyyy')}`
    const taken = await this.legacyTaken(trx, original, null)
    const takenAt = (row: { vatRate: string; natura: string | null }) =>
      taken
        .filter(
          (other) => Number(other.vatRate) === Number(row.vatRate) && other.natura === row.natura
        )
        .reduce((total, other) => total.plus(other.taxable), new Big(0))
    const entries = original.advance
      ? await this.legacyAdvanceEntries(trx, original, takenAt)
      : await this.legacyEntry(trx, original, taken)
    const values = entries
      .filter(({ amount }) => amount.gt(0))
      .map(({ code, amount }, position) => ({
        invoiceId: creditNoteId,
        position,
        description: label,
        quantity: '1',
        unit: null,
        unitPrice: amount.toFixed(2),
        discountPercent: '0',
        vatCodeId: code.id,
        vatRate: code.rate,
        natura: code.natura,
        legalNote: code.legalNote,
        lineTotal: amount.toFixed(2),
      }))
    const deducted = original.advance ? await this.advanceDeducted(trx, original.id) : '0'
    const left = new Big(
      creditLeft(original.total!, await Payments.credited(trx, original.id), deducted)
    )
    const totalOf = () =>
      new Big(invoiceTotals(values.map((value) => ({ ...value, deduction: false }))).total)
    const setAmount = (value: (typeof values)[number], amount: Big) =>
      Object.assign(value, { unitPrice: amount.toFixed(2), lineTotal: amount.toFixed(2) })
    if (values.length && totalOf().gt(left)) {
      const ratio = left.lt(0) ? new Big(0) : left.div(totalOf())
      for (const value of values) {
        setAmount(value, new Big(value.lineTotal).times(ratio).round(2, Big.roundDown))
      }
      // Rounded down, a row's VAT may still round up by a cent: a few at most
      for (let cents = 0; cents < 10 * values.length && totalOf().gt(left); cents++) {
        const largest = values.reduce((max, value) =>
          new Big(value.lineTotal).gt(max.lineTotal) ? value : max
        )
        setAmount(largest, new Big(largest.lineTotal).minus('0.01'))
      }
    }
    return values.filter((value) => new Big(value.lineTotal).gt(0))
  }

  /**
   * What is left of each VAT row of a Legacy advance, at its VAT Code.
   */
  private static async legacyAdvanceEntries(
    trx: TransactionClientContract,
    original: Invoice,
    takenAt: (row: { vatRate: string; natura: string | null }) => Big
  ) {
    const rows = await LegacyVatRow.query({ client: trx })
      .where('invoiceId', original.id)
      .orderBy('position')
    return rows.map((row) => ({
      code: { id: row.vatCodeId, rate: row.vatRate, natura: row.natura, legalNote: row.legalNote },
      amount: new Big(row.taxable).minus(takenAt(row)),
    }))
  }

  /**
   * What is left of a Legacy Invoice that isn't an advance, at the VAT
   * Code its printed VAT shows, within the VAT left too; none without one.
   */
  private static async legacyEntry(
    trx: TransactionClientContract,
    original: Invoice,
    taken: { taxable: string; vat?: string }[]
  ) {
    const code = await this.legacyVatCode(trx, original)
    if (!code) return []
    const taxableLeft = taken.reduce(
      (left, row) => left.minus(row.taxable),
      new Big(original.taxable!)
    )
    const vatLeft = taken.reduce((left, row) => left.minus(row.vat ?? 0), new Big(original.vat!))
    // The most whose VAT, rounded half-up, stays within what is left of it
    const byVat = vatLeft.plus('0.005').times(100).div(code.rate).round(2, Big.roundDown)
    const amount = byVat.lt(taxableLeft) ? byVat : taxableLeft
    return [{ code, amount }]
  }

  /**
   * The active VAT Code without Natura whose rate, on the printed taxable,
   * gives the printed VAT; null when none does (0 VAT: exempt, reverse
   * charge or out of scope, whose Natura can't be told from the totals).
   */
  private static async legacyVatCode(trx: TransactionClientContract, original: Invoice) {
    const codes = await VatCode.query({ client: trx })
      .withScopes((scopes) => scopes.active())
      .whereNull('natura')
      .where('rate', '>', 0)
      .orderBy('rate', 'desc')
    return (
      codes.find((code) =>
        new Big(legacyRowVat({ vatRate: code.rate, taxable: original.taxable! })).eq(original.vat!)
      ) ?? null
    )
  }

  /**
   * The taxable already taken back of a Legacy Invoice, by VAT treatment:
   * for an advance, what issued Invoices deducted and other Credit Notes
   * credited at each of its VAT rows (advancesOf()); otherwise what its
   * Credit Notes past draft credited. All but the Credit Note `except`.
   */
  private static async legacyTaken(
    trx: TransactionClientContract,
    original: Invoice,
    except: number | null
  ) {
    if (original.advance) {
      const advances = await this.advancesOf(trx, original.jobId!, except)
      return advances.find((entry) => entry.advance.id === original.id)?.taken ?? []
    }
    const notes = await Invoice.query({ client: trx })
      .where('creditsInvoiceId', original.id)
      .whereNot('status', 'draft')
      .whereNot('id', except ?? 0)
      .preload('lines')
    return notes.flatMap((note) =>
      note.totals.summary.map((row) => ({
        vatRate: row.vatRate,
        natura: row.natura,
        taxable: row.taxable,
        vat: row.vat,
      }))
    )
  }

  /**
   * What the Credit Notes past draft on the Invoice `invoiceId` credit of
   * each of its lines, by line id, counting all but `except`.
   */
  private static async lineCredits(
    trx: TransactionClientContract,
    invoiceId: number,
    except: number | null = null
  ) {
    const rows = await trx
      .from('invoice_lines as l')
      .join('invoices as cn', 'cn.id', 'l.invoice_id')
      .where('cn.credits_invoice_id', invoiceId)
      .whereNot('cn.status', 'draft')
      .whereNot('cn.id', except ?? 0)
      .groupBy('l.credits_line_id')
      .select('l.credits_line_id')
      .sum('l.line_total as credited')
    return new Map<number, string>(
      rows.map((row) => [row.credits_line_id, new Big(row.credited).toFixed(2)])
    )
  }

  /**
   * What issued Invoices deducted of the advance `advanceId`, less what
   * Credit Notes gave back (ADVANCE_DEDUCTED_SQL).
   */
  private static async advanceDeducted(trx: TransactionClientContract, advanceId: number) {
    const result = await trx.rawQuery(
      `SELECT ${ADVANCE_DEDUCTED_SQL('a')} AS deducted FROM invoices a WHERE a.id = ?`,
      [advanceId]
    )
    return new Big(result.rows[0].deducted).toFixed(2)
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
   * Notes above the Invoice's total, or above what is left to take back
   * of an advance, counting the others that credit (credits()); then each
   * of its lines as lineCreditRefusal() says. Runs with the credited
   * Invoice's Job and the Invoice locked (whileIn()), so two Credit Notes,
   * or a Credit Note and a deduction, can't pass the check together.
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
    const originalLines = await InvoiceLine.query({ client: trx }).where('invoiceId', original.id)
    const lines = await InvoiceLine.query({ client: trx }).where('invoiceId', creditNote.id)
    // A deduction is given back whole: all its lines (one per VAT row of
    // the advance) or none, so the advance's amount comes back exactly
    const advanceIds = new Set(originalLines.map((line) => line.deductsInvoiceId))
    advanceIds.delete(null)
    for (const advanceId of advanceIds) {
      const deductionLines = originalLines.filter((line) => line.deductsInvoiceId === advanceId)
      const given = deductionLines.filter((line) =>
        lines.some((credit) => credit.creditsLineId === line.id)
      )
      if (given.length && given.length < deductionLines.length) {
        throw new InvoiceNotFinalisableError('partialDeduction')
      }
    }

    const deducted = original.advance ? await this.advanceDeducted(trx, original.id) : '0'
    if (exceedsCredit(total, original.total!, others.toFixed(2), deducted)) {
      throw new InvoiceNotFinalisableError('creditTooLarge')
    }
    // A Legacy Invoice has no lines: its Credit Note credits amounts, by
    // VAT row of an advance, or within the printed taxable (#27)
    if (original.isLegacy) {
      const rows = original.advance
        ? await LegacyVatRow.query({ client: trx }).where('invoiceId', original.id)
        : null
      const refusal = legacyCreditRefusal({
        rows,
        taxable: original.taxable!,
        vat: original.vat!,
        lines,
        taken: await this.legacyTaken(trx, original, creditNote.id),
      })
      if (refusal) throw new InvoiceNotFinalisableError(refusal)
      return
    }

    const byOthers = await this.lineCredits(trx, original.id, creditNote.id)
    for (const line of originalLines) {
      const crediting = lines.filter((credit) => credit.creditsLineId === line.id)
      if (!crediting.length) continue
      const refusal = lineCreditRefusal({
        lineTotal: line.lineTotal,
        deduction: line.deductsInvoiceId !== null,
        lines: crediting,
        creditedByOthers: byOthers.get(line.id) ?? '0',
      })
      if (refusal) throw new InvoiceNotFinalisableError(refusal)
    }

    // A rejected Credit Note corrected so it no longer gives a deduction
    // back makes the deduction count again: never beyond its advance, which
    // may have been credited or deducted again since (with the lines as
    // written, the Job locked)
    for (const advanceId of advanceIds) {
      const result = await trx.rawQuery(
        `SELECT a.total < ${ADVANCE_TAKEN_BACK_SQL('a')} AS over FROM invoices a WHERE a.id = ?`,
        [advanceId!]
      )
      if (result.rows[0]?.over) throw new InvoiceNotFinalisableError('deductionTooLarge')
    }
  }

  /**
   * Credits the Charges of each line of the Invoice `invoiceId` its Credit
   * Notes past draft credit in full (creditedInFull(), ADR 0014): each
   * still billed by that line gets a "credited" event naming `creditNote`.
   * A line no longer credited in full (a rejected Credit Note corrected)
   * gives its credited Charges back their billing ("uncredited"). A Charge
   * set back to bill or billed elsewhere since is left alone. Runs with
   * the Invoice's Job and the Invoice locked; locks the Charges.
   */
  private static async creditCharges(
    trx: TransactionClientContract,
    invoiceId: number,
    creditNote: Invoice,
    user: User | null
  ) {
    const links = await this.links(trx, invoiceId)
    if (!links.length) return
    const chargeIds = [...new Set(links.map((link) => link.chargeId))]
    await Charge.query({ client: trx }).whereIn('id', chargeIds).orderBy('id').forUpdate()
    const lines = await InvoiceLine.query({ client: trx }).where('invoiceId', invoiceId)
    const credited = await this.lineCredits(trx, invoiceId)
    const full = new Set(
      lines
        .filter((line) => creditedInFull(line.lineTotal, credited.get(line.id) ?? null))
        .map((line) => line.id)
    )
    const events = await ChargeEvent.query({ client: trx })
      .whereIn('chargeId', chargeIds)
      .whereIn('kind', [...BILLING_EVENT_KINDS])
      .orderBy('id')
    const latest = new Map(events.map((event) => [event.chargeId, event]))
    for (const { lineId, chargeId } of links) {
      const billing = latest.get(chargeId)
      if (billing?.invoiceLineId !== lineId) continue
      const billed = billing.kind === 'billed' || billing.kind === 'uncredited'
      let kind: 'credited' | 'uncredited' | null = null
      if (full.has(lineId) && billed) kind = 'credited'
      if (!full.has(lineId) && billing.kind === 'credited') kind = 'uncredited'
      if (!kind) continue
      await ChargeEvent.create(
        {
          chargeId,
          kind,
          userId: user?.id ?? null,
          invoiceId: creditNote.id,
          invoiceLineId: lineId,
        },
        { client: trx }
      )
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
      // A Legacy advance has VAT rows instead of lines (#27)
      .preload('legacyVatRows', (rows) => rows.orderBy('position'))
      .orderBy('id')
    const ids = advances.map((advance) => advance.id)
    const issuedOthers = (builder: any) =>
      builder.whereNot('di.status', 'draft').whereNot('di.id', except ?? 0)
    // Deductions a Credit Note gave back no longer count (ADR 0014)
    const amounts = ids.length
      ? await issuedOthers(
          query
            .from('advance_deductions as ad')
            .join('invoices as di', 'di.id', 'ad.invoice_id')
            .whereIn('ad.advance_id', ids)
            .whereRaw(`NOT ${DEDUCTION_REVERSED_SQL('ad')}`)
        )
          .groupBy('ad.advance_id')
          .select('ad.advance_id')
          .sum('ad.amount as amount')
      : []
    // Invoices' deduction lines (a Credit Note's lines giving one back
    // copy it, and are left out with it)
    const rows = ids.length
      ? await issuedOthers(
          query
            .from('invoice_lines as l')
            .join('invoices as di', 'di.id', 'l.invoice_id')
            .whereIn('l.deducts_invoice_id', ids)
            .where('di.document_type', 'invoice')
            .whereNotExists((given: any) =>
              given
                .from('invoice_lines as rl')
                .join('invoices as rn', 'rn.id', 'rl.invoice_id')
                .whereColumn('rl.credits_line_id', 'l.id')
                .whereNot('rn.status', 'draft')
            )
        )
          .groupBy('l.deducts_invoice_id', 'l.vat_rate', 'l.natura')
          .select('l.deducts_invoice_id', 'l.vat_rate', 'l.natura')
          .sum('l.line_total as total')
      : []
    // Credit Notes on the advances, which take back what they credit
    const creditNotes = ids.length
      ? await Invoice.query({ client })
          .whereIn('creditsInvoiceId', ids)
          .whereNot('status', 'draft')
          .whereNot('id', except ?? 0)
          .preload('lines')
      : []
    return advances.map((advance) => {
      const deducted = amounts.find((row: any) => row.advance_id === advance.id)?.amount ?? '0'
      const notes = creditNotes.filter((note) => note.creditsInvoiceId === advance.id)
      const credited = sumAmounts(notes.map((note) => note.total!))
      return {
        advance,
        deducted: new Big(deducted).toFixed(2),
        credited,
        left: advanceLeft(advance.total!, deducted, credited),
        taken: [
          ...rows
            .filter((row: any) => row.deducts_invoice_id === advance.id)
            .map((row: any) => ({
              vatRate: row.vat_rate as string,
              natura: row.natura as string | null,
              taxable: new Big(row.total).neg().toFixed(2),
            })),
          ...notes.flatMap((note) =>
            note.totals.summary.map((row) => ({
              vatRate: row.vatRate,
              natura: row.natura,
              taxable: row.taxable,
            }))
          ),
        ],
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
          const source = advance.vatTreatment(row.vatRate, row.natura)
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
   * Quote (ADR 0012): one line per done Charge to bill (ADR 0016) on its
   * closed Visits and on the Job itself, with what Office set
   * to bill (quantity, price, description; ADR 0010). The Job page's
   * running total also counts what is still planned, held by a draft or
   * billed, so it isn't this draft's total. Each line gets the VAT Code
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
      // A draft that bills everything outstanding (no Visit still to come,
      // no planned Charge on the Job, ADR 0016) takes back what is left of
      // each advance; others start with none, and Office can change both
      // (ADR 0011)
      const moreWork =
        (await Visit.query({ client: trx })
          .where('jobId', locked.id)
          .whereIn('status', [...OPEN_VISIT_STATUSES])
          .first()) ||
        (await trx
          .from('charges')
          .where('job_id', locked.id)
          .whereRaw(`${WORK_STATE_SQL('charges')} = 'planned'`)
          .whereRaw(OUTSTANDING_SQL('charges'))
          .first())
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
      // A Credit Note carries its Invoice's global discount, so its lines
      // credit the Invoice's lines on the same footing (ADR 0014)
      const creditedInvoice = locked.isCreditNote
        ? await Invoice.query({ client: trx }).where('id', locked.creditsInvoiceId!).firstOrFail()
        : null
      locked.merge({
        discountPercent: creditedInvoice
          ? creditedInvoice.discountPercent
          : (input.discountPercent ?? '0'),
        notes: input.notes ?? null,
      })
      await locked.save()

      // Deduction lines follow the deductions (see deduct); on a Credit
      // Note they give a deduction back, and Office keeps or removes them
      const entries = locked.isCreditNote
        ? input.lines
        : input.lines.filter((line) => !line.deductsInvoiceId)
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
      // A Credit Note's lines are all Office's; an Invoice's deduction
      // lines follow its deductions
      const ownLines = () => {
        const query = InvoiceLine.query({ client: trx }).where('invoiceId', locked.id)
        return locked.isCreditNote ? query : query.whereNull('deductsInvoiceId')
      }
      const existing = await ownLines()
      const byId = new Map(existing.map((line) => [line.id, line]))
      // A Credit Note's lines each credit a line of its Invoice
      // (a Legacy Invoice has none: its Credit Note's lines are free, #27)
      const creditedLines =
        creditedInvoice && !creditedInvoice.isLegacy
          ? await InvoiceLine.query({ client: trx }).where('invoiceId', creditedInvoice.id)
          : null
      const creditable = creditedLines
        ? new Map(creditedLines.map((line) => [line.id, line]))
        : null
      const creditedLineOf = (line: InvoiceLineInput) => {
        if (!creditable) return null
        const id = line.creditsLineId ?? (line.id ? byId.get(line.id)?.creditsLineId : null)
        const creditedLine = id ? creditable.get(id) : undefined
        if (!creditedLine) throw new InvoiceNotFinalisableError('uncreditedLine')
        return creditedLine
      }
      const values = entries.map((line, position) => {
        const creditedLine = creditedLineOf(line)
        // A deduction is given back exactly as it was taken (ADR 0014)
        const given = creditedLine?.deductsInvoiceId ? creditedLine : null
        if (given) {
          return {
            invoiceId: locked.id,
            creditsLineId: given.id,
            deductsInvoiceId: given.deductsInvoiceId,
            position,
            itemId: null,
            description: given.description,
            quantity: given.quantity,
            unit: given.unit,
            unitPrice: given.unitPrice,
            discountPercent: given.discountPercent,
            vatCodeId: given.vatCodeId,
            vatRate: given.vatRate,
            natura: given.natura,
            legalNote: given.legalNote,
            lineTotal: given.lineTotal,
          }
        }
        // A Credit Note reverses VAT as the Invoice charged it, whatever
        // the request says and whatever the VAT Code says now
        const code = creditedLine
          ? {
              id: creditedLine.vatCodeId,
              rate: creditedLine.vatRate,
              natura: creditedLine.natura,
              legalNote: creditedLine.legalNote,
            }
          : vat.get(line.vatCodeId)!
        const discountPercent = line.discountPercent ?? '0'
        return {
          invoiceId: locked.id,
          creditsLineId: creditedLine?.id ?? null,
          deductsInvoiceId: null,
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
      await ownLines()
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
      // Kept as they were unless sent; never more than is left of an
      // advance. A Credit Note takes nothing back
      const deducts =
        !locked.isCreditNote &&
        (await this.deduct(
          trx,
          locked,
          input.deductions ?? (await this.deductionsOf(trx, locked.id)),
          entries.length
        ))
      const lines = await InvoiceLine.query({ client: trx }).where('invoiceId', locked.id)
      const total = new Big(this.totalOf(lines, locked.discountPercent))
      // Taking advances back, or giving them back, can't bring the total
      // below zero
      if ((deducts || locked.isCreditNote) && total.lt(0)) {
        throw new InvoiceNotFinalisableError('negativeTotal')
      }
      // Drafts too, so Office learns early what is left to credit
      if (locked.isCreditNote) await this.checkCredit(trx, locked, total.toFixed(2))

      // A corrected Invoice's total changes with its lines; it must still
      // be one that could be issued
      if (locked.status !== 'draft') {
        locked.total = total.toFixed(2)
        if (total.lt(0)) throw new InvoiceNotFinalisableError('negativeTotal')
        // An advance can't be corrected below what issued Invoices took back
        // (a rejected one has no Credit Notes, so this is what they deducted)
        if (locked.advance) {
          const taken = await trx.rawQuery(
            `SELECT ${ADVANCE_TAKEN_BACK_SQL('a')} AS taken
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
        // about, as when finalising one. A line it no longer credits in
        // full gives its Charges back their billing, and one it now does
        // credits them
        if (locked.isCreditNote) {
          creditedOverpaidBy = await this.overpaidBy(trx, locked.creditsInvoiceId!)
          await this.creditCharges(trx, locked.creditsInvoiceId!, locked, user)
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
      // saved: its deductions must still fit, their lines as they are now.
      // A Credit Note's lines giving a deduction back stay as saved
      if (!locked.isCreditNote) {
        const regular = await InvoiceLine.query({ client: trx })
          .where('invoiceId', locked.id)
          .whereNull('deductsInvoiceId')
        await this.deduct(trx, locked, await this.deductionsOf(trx, locked.id), regular.length)
      }
      const lines = await InvoiceLine.query({ client: trx })
        .where('invoiceId', locked.id)
        .orderBy('position')
      if (!lines.length) throw new InvoiceNotFinalisableError('empty')
      const total = new Big(this.totalOf(lines, locked.discountPercent))
      if (total.lt(0)) throw new InvoiceNotFinalisableError('negativeTotal')
      // An advance of nothing would only add empty deduction lines; a
      // Credit Note of nothing credits nothing, unless it gives a deduction
      // back (work credited for as much as the advance it took back)
      const givesBack = lines.some((line) => line.deductsInvoiceId !== null)
      if ((locked.advance || (locked.isCreditNote && !givesBack)) && total.eq(0)) {
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
      // A Credit Note credits the Charges of the lines now credited in full
      if (locked.isCreditNote) {
        await this.creditCharges(trx, locked.creditsInvoiceId!, locked, user)
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
   * re-read, refusing unless its status passes `allowed` (and always for a
   * Legacy Invoice). A Credit Note first locks the Invoice it credits,
   * after that Invoice's Job, so checking what is left to credit sees the
   * other Credit Notes as they are.
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
      // A Legacy Invoice has no lines and no lifecycle of its own (#27):
      // only LegacyInvoices changes it
      if (!allowed(locked.status) || locked.isLegacy) throw new InvoiceNotEditableError()
      return work(trx, locked)
    })
  }
}
