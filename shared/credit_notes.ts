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
 * - `advance`: crediting an Advance Invoice changes what is left of it to
 *   take back, which comes with #146.
 * Legacy Invoices (#27) are outside the SDI flow and will be refused here
 * too, once they exist.
 */
export type CreditRefusal = 'creditNote' | 'notIssued' | 'advance'

/** SDI delivered it, or reported it not deliverable: either way it is issued */
export const CREDITABLE_STATUSES: readonly InvoiceStatus[] = ['delivered', 'not_deliverable']

export function creditRefusal(invoice: {
  documentType: DocumentType
  status: InvoiceStatus
  advance: boolean
}): CreditRefusal | null {
  if (invoice.documentType === 'credit_note') return 'creditNote'
  if (!CREDITABLE_STATUSES.includes(invoice.status)) return 'notIssued'
  if (invoice.advance) return 'advance'
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
 * Credit Notes on one Invoice never add up to more than its total.
 */
export function creditLeft(invoiceTotal: string, creditedByOthers: string) {
  return new Big(invoiceTotal).minus(creditedByOthers).toFixed(2)
}

export function exceedsCredit(total: string, invoiceTotal: string, creditedByOthers: string) {
  return new Big(total).gt(creditLeft(invoiceTotal, creditedByOthers))
}
