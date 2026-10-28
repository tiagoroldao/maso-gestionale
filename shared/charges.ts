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
  'billed',
  'unbilled',
] as const
export type ChargeEventKind = (typeof CHARGE_EVENT_KINDS)[number]

/**
 * To bill, not billable, held by a draft Invoice, or billed by an issued
 * one.
 */
export const CHARGE_STATES = ['to_bill', 'not_billable', 'in_draft', 'billed'] as const
export type ChargeState = (typeof CHARGE_STATES)[number]

/**
 * A Charge's state, from its history (oldest event first) and whether a
 * draft Invoice holds it. The latest "not billable" or "billable" event
 * decides whether it is billable; the latest "billed" or "set back to
 * bill" event whether an issued Invoice bills it (a draft only holds it).
 */
export function chargeState(events: { kind: string }[], heldByDraft: boolean): ChargeState {
  const decision = events.findLast(
    (event) => event.kind === 'not_billable' || event.kind === 'billable'
  )
  if (decision?.kind === 'not_billable') return 'not_billable'
  const billing = events.findLast((event) => event.kind === 'billed' || event.kind === 'unbilled')
  if (billing?.kind === 'billed') return 'billed'
  return heldByDraft ? 'in_draft' : 'to_bill'
}

/**
 * A draft holds the Charge, or an issued Invoice bills it: what is billed
 * changes only through billing (ADR 0010).
 */
export function isHeld(state: ChargeState) {
  return state === 'in_draft' || state === 'billed'
}

/**
 * Still waiting for an issued Invoice: to bill, or only held by a draft.
 */
export function isOutstanding(state: ChargeState) {
  return state === 'to_bill' || state === 'in_draft'
}

/**
 * A Visit is billed once it is closed and none of its Charges are
 * outstanding.
 */
export function isVisitBilled(closed: boolean, states: ChargeState[]) {
  return closed && !states.some(isOutstanding)
}
