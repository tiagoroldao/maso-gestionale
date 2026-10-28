/**
 * Charges (ADR 0010): what a Job can be billed for, with a history. Used
 * by the server and the Office pages alike.
 */

/**
 * Hours at a Labour Rate, an Item used, or any other cost Office adds to a
 * Job (a call-out, a contractor's day, materials bought for the Job).
 */
export const CHARGE_KINDS = ['labour', 'item', 'other'] as const
export type ChargeKind = (typeof CHARGE_KINDS)[number]

export const CHARGE_EVENT_KINDS = [
  'recorded',
  'corrected',
  'billing_edited',
  'not_billable',
  'billable',
] as const
export type ChargeEventKind = (typeof CHARGE_EVENT_KINDS)[number]

/**
 * To bill, not billable, or held by an Invoice: still a draft, or billed.
 */
export const CHARGE_STATES = ['to_bill', 'not_billable', 'in_draft', 'billed'] as const
export type ChargeState = (typeof CHARGE_STATES)[number]

/**
 * A Charge's state, from its history (oldest event first) and the status
 * of the Invoice holding it, if any. The latest "not billable" or
 * "billable" event decides whether it is billable.
 */
export function chargeState(events: { kind: string }[], invoiceStatus: string | null): ChargeState {
  const decision = events.findLast(
    (event) => event.kind === 'not_billable' || event.kind === 'billable'
  )
  if (decision?.kind === 'not_billable') return 'not_billable'
  if (invoiceStatus === null) return 'to_bill'
  return invoiceStatus === 'draft' ? 'in_draft' : 'billed'
}
