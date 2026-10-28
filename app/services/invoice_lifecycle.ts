/**
 * The Invoice lifecycle. A draft is finalised (numbered); a Submission
 * sends it to SDI; SDI's outcome delivers it, reports it not deliverable
 * (the Customer finds it in their tax drawer, so it still counts), or
 * rejects it. A rejected Invoice keeps its number and date, can be
 * corrected and is submitted again.
 */
export const INVOICE_STATUSES = [
  'draft',
  'finalised',
  'submitted',
  'delivered',
  'not_deliverable',
  'rejected',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export type InvoiceEvent = 'finalise' | 'submit' | 'deliver' | 'notDeliverable' | 'reject'

const TRANSITIONS: Record<InvoiceEvent, Partial<Record<InvoiceStatus, InvoiceStatus>>> = {
  finalise: { draft: 'finalised' },
  submit: { finalised: 'submitted', rejected: 'submitted' },
  deliver: { submitted: 'delivered' },
  notDeliverable: { submitted: 'not_deliverable' },
  reject: { submitted: 'rejected' },
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: InvoiceStatus,
    readonly event: InvoiceEvent
  ) {
    super(`Cannot ${event} an Invoice that is ${from}`)
  }
}

/**
 * The status after `event`, or an error if the event doesn't apply.
 */
export function transition(from: InvoiceStatus, event: InvoiceEvent): InvoiceStatus {
  const to = TRANSITIONS[event][from]
  if (!to) throw new InvalidTransitionError(from, event)
  return to
}

export function canTransition(from: InvoiceStatus, event: InvoiceEvent) {
  return Boolean(TRANSITIONS[event][from])
}

/** Lines and discounts can change only on a draft or after a Rejection */
export const isEditable = (status: InvoiceStatus) => status === 'draft' || status === 'rejected'

/** Only drafts have no number to keep, so only drafts can be deleted */
export const isDeletable = (status: InvoiceStatus) => status === 'draft'

/** SDI allows five days from a Rejection to submit the corrected Invoice */
export const RESUBMISSION_DAYS = 5
