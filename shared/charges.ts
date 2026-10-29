import { isCancelledVisit, isClosedVisit } from './visits.js'

/**
 * Charges (ADR 0010): what a Job can be billed for, with a history. Used
 * by the server and the Office pages alike.
 */

/**
 * Hours at a Labour Rate, an Item used, or any other cost Office adds to a
 * Job (a call-out, a contractor's day, materials bought for the Job).
 */
export const CHARGE_KINDS = ['labour', 'item', 'other'] as const

/**
 * The longest description a Charge bills, as long as an Invoice line's.
 */
export const CHARGE_DESCRIPTION_MAX = 1000
export type ChargeKind = (typeof CHARGE_KINDS)[number]

export const CHARGE_EVENT_KINDS = [
  'recorded',
  'corrected',
  'billing_edited',
  'not_billable',
  'billable',
  'billed',
  'unbilled',
  'credited',
  'uncredited',
  'planned',
  'done',
  'not_done',
] as const
export type ChargeEventKind = (typeof CHARGE_EVENT_KINDS)[number]

/**
 * The events that move a Charge in and out of issued documents: billed by
 * an Invoice, set back to bill, credited by Credit Notes crediting its
 * line in full, and uncredited when a corrected Credit Note no longer
 * does (ADR 0014).
 */
export const BILLING_EVENT_KINDS = ['billed', 'unbilled', 'credited', 'uncredited'] as const

/**
 * To bill, not billable, held by a draft Invoice, billed by an issued
 * one, or credited: its line was credited in full (ADR 0014).
 */
export const CHARGE_STATES = ['to_bill', 'not_billable', 'in_draft', 'billed', 'credited'] as const
export type ChargeState = (typeof CHARGE_STATES)[number]

/**
 * Whether the work happened (ADR 0016): planned, done or not done. Stock
 * follows it; only done Charges are billed.
 */
export const WORK_STATES = ['planned', 'done', 'not_done'] as const
export type WorkState = (typeof WORK_STATES)[number]

/**
 * The events that set a Charge's work state, one per state.
 */
export const WORK_EVENT_KINDS = WORK_STATES

/**
 * A Charge's work state, from its history (oldest event first): the latest
 * work event, or planned before any (recorded in the field or imported from
 * a Quote, until its Visit closes or Office confirms it). Independent of
 * its billing state. WORK_STATE_SQL says the same in SQL.
 */
export function workState(events: { kind: string }[]): WorkState {
  const latest = events.findLast((event) =>
    (WORK_EVENT_KINDS as readonly string[]).includes(event.kind)
  )
  return (latest?.kind as WorkState | undefined) ?? 'planned'
}

const isBillingEvent = (kind: string) => (BILLING_EVENT_KINDS as readonly string[]).includes(kind)

/**
 * A Charge's state, from its history (oldest event first) and whether a
 * draft Invoice holds it. The latest "not billable" or "billable" event
 * decides whether it is billable; the latest billing event whether an
 * issued Invoice bills it ("billed", or "uncredited", which gives back the
 * billing a credit took), Credit Notes credited it, or it was set back to
 * bill (a draft then only holds it). CHARGE_STATE_SQL says the same in
 * SQL.
 */
export function chargeState(events: { kind: string }[], heldByDraft: boolean): ChargeState {
  const decision = events.findLast(
    (event) => event.kind === 'not_billable' || event.kind === 'billable'
  )
  if (decision?.kind === 'not_billable') return 'not_billable'
  const billing = events.findLast((event) => isBillingEvent(event.kind))
  if (billing?.kind === 'billed' || billing?.kind === 'uncredited') return 'billed'
  if (billing?.kind === 'credited') return 'credited'
  return heldByDraft ? 'in_draft' : 'to_bill'
}

/**
 * A draft holds the Charge, an issued Invoice bills it, or Credit Notes
 * credited it: what is billed changes only through billing (ADR 0010,
 * 0014).
 */
export function isHeld(state: ChargeState) {
  return state === 'in_draft' || state === 'billed' || state === 'credited'
}

/**
 * Billed by an issued Invoice, credited or not: Office can set it back to
 * bill, to bill the work again (ADR 0010, 0014).
 */
export function canSetBackToBill(state: ChargeState) {
  return state === 'billed' || state === 'credited'
}

/**
 * Still waiting for an issued Invoice: to bill, or only held by a draft,
 * and done or still planned (planned work keeps billing open, ADR 0016).
 * A not done Charge never is; a credited Charge is final, like one not
 * billable, until Office sets it back to bill.
 */
export function isOutstanding(state: ChargeState, work: WorkState) {
  return work !== 'not_done' && (state === 'to_bill' || state === 'in_draft')
}

/**
 * What a draft Invoice from the Job takes: done and to bill (ADR 0016).
 */
export function isDraftable(state: ChargeState, work: WorkState) {
  return work === 'done' && state === 'to_bill'
}

/**
 * A Visit is billed once it is closed, or cancelled (its Charges then not
 * done, #157), and none of its Charges are outstanding. VISIT_BILLED_SQL
 * says the same in SQL.
 */
export function isVisitBilled(status: string, charges: { state: ChargeState; work: WorkState }[]) {
  const settled = isClosedVisit(status) || isCancelledVisit(status)
  return settled && !charges.some((charge) => isOutstanding(charge.state, charge.work))
}
