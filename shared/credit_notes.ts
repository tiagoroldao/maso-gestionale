import Big from 'big.js'
import type { InvoiceStatus } from './invoice_lifecycle.js'

/**
 * Credit Notes (ADR 0014): a fiscal document (FatturaPA TD04) crediting
 * one issued Invoice, partly or fully. It is stored as an Invoice record
 * of its own type, with the same lifecycle. Used by the server and the
 * Office pages alike.
 */
export const DOCUMENT_TYPES = ['invoice', 'credit_note'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

/**
 * How Credit Notes are numbered: in the Invoice sequence, or in a series
 * of their own (sezionale), an Admin setting.
 */
export const CREDIT_NOTE_NUMBERING_MODES = ['shared', 'own'] as const
export type CreditNoteNumberingMode = (typeof CREDIT_NOTE_NUMBERING_MODES)[number]

/** The sequence a number is taken from */
export type NumberingSeries = 'invoice' | 'credit_note'

/**
 * Why an Invoice can't be credited:
 * - `creditNote`: it is a Credit Note itself;
 * - `notIssued`: SDI hasn't delivered it nor reported it not deliverable
 *   (a draft, finalised or submitted Invoice isn't issued yet; a rejected
 *   one is corrected, never credited);
 * - `advanceTakenBack`: an Advance Invoice with nothing left to take back,
 *   all of it deducted by issued Invoices or credited already (ADR 0014);
 *   checked when the Credit Note is drafted, since it needs what was
 *   deducted.
 * Legacy Invoices (#27) are outside the SDI flow and will be refused here
 * too, once they exist.
 */
export type CreditRefusal = 'creditNote' | 'notIssued' | 'advanceTakenBack'

/** SDI delivered it, or reported it not deliverable: either way it is issued */
export const CREDITABLE_STATUSES: readonly InvoiceStatus[] = ['delivered', 'not_deliverable']

export function creditRefusal(invoice: {
  documentType: DocumentType
  status: InvoiceStatus
}): CreditRefusal | null {
  if (invoice.documentType === 'credit_note') return 'creditNote'
  if (!CREDITABLE_STATUSES.includes(invoice.status)) return 'notIssued'
  return null
}

/**
 * Whether a Credit Note in `status` credits its Invoice: once finalised,
 * whatever SDI answers. A rejected Credit Note keeps its number and is
 * corrected and submitted again, like an Invoice, so it still counts;
 * only a draft, which can still be deleted, doesn't (as with advances
 * taken back). The SQL equivalent is CREDITED_SQL.
 */
export const credits = (status: InvoiceStatus) => status !== 'draft'

/**
 * What a Credit Note of `total` can credit, at most, on an Invoice of
 * `invoiceTotal` whose other Credit Notes credit `creditedByOthers`: the
 * Credit Notes on one Invoice never add up to more than its total. On an
 * Advance Invoice, what issued Invoices `deducted` of it is taken back
 * already, so only what is still left can be credited (ADR 0014).
 */
export function creditLeft(invoiceTotal: string, creditedByOthers: string, deducted = '0') {
  return new Big(invoiceTotal).minus(creditedByOthers).minus(deducted).toFixed(2)
}

export function exceedsCredit(
  total: string,
  invoiceTotal: string,
  creditedByOthers: string,
  deducted = '0'
) {
  return new Big(total).gt(creditLeft(invoiceTotal, creditedByOthers, deducted))
}

/**
 * Each line of a Credit Note credits a line of its Invoice by amount (its
 * line total, before the global discount, which a Credit Note always
 * carries as its Invoice does). A line's Credit Notes together never
 * credit more than it, and a Credit Note line is never negative, except
 * one giving back a deduction (`deduction`), which copies the deduction
 * line exactly and only once (`deductionGivenBack` otherwise; ADR 0011,
 * 0014).
 */
export type LineCreditRefusal = 'lineCreditTooLarge' | 'negativeCredit' | 'deductionGivenBack'

export function lineCreditRefusal(credited: {
  /** The Invoice line's amount */
  lineTotal: string
  /** Whether that line takes back an advance */
  deduction: boolean
  /** The Credit Note's lines crediting it */
  lines: { unitPrice: string; lineTotal: string }[]
  /** What its other Credit Notes past draft credit of it */
  creditedByOthers: string
}): LineCreditRefusal | null {
  const sum = credited.lines.reduce((total, line) => total.plus(line.lineTotal), new Big(0))
  if (credited.deduction) {
    // Given back once, as it was
    const once = credited.lines.length === 1 && new Big(credited.creditedByOthers).eq(0)
    return once && sum.eq(credited.lineTotal) ? null : 'deductionGivenBack'
  }
  const negative = credited.lines.some(
    (line) => new Big(line.unitPrice).lt(0) || new Big(line.lineTotal).lt(0)
  )
  if (negative) return 'negativeCredit'
  return sum.plus(credited.creditedByOthers).gt(credited.lineTotal) ? 'lineCreditTooLarge' : null
}

/**
 * Whether the Invoice line of `lineTotal` is credited in full by `credited`,
 * all its Credit Notes past draft together: its Charges are then credited
 * (ADR 0014). A line no Credit Note credits isn't, even at zero.
 */
export function creditedInFull(lineTotal: string, credited: string | null) {
  return credited !== null && new Big(credited).gte(lineTotal)
}
