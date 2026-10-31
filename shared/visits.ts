/**
 * The statuses a Technician sets in the field: under way, then closed
 * (done, or needing another visit).
 */
export const FIELD_VISIT_STATUSES = ['planned', 'in_progress', 'done', 'needs_return'] as const

/**
 * Every Visit status: the field's, and cancelled, which only Office sets
 * (#157).
 */
export const VISIT_STATUSES = [...FIELD_VISIT_STATUSES, 'cancelled'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]
export type FieldVisitStatus = (typeof FIELD_VISIT_STATUSES)[number]

/**
 * Statuses that close a Visit: its Items are taken off stock and its
 * hours, Items, status and time become final. "Needs another visit" closes
 * this Visit too; the follow-up is a new Visit.
 */
export const CLOSED_VISIT_STATUSES = ['done', 'needs_return'] as const

/**
 * Statuses of a Visit still to happen or under way: the only ones that
 * take field work, move on the Agenda, or can be cancelled.
 */
export const OPEN_VISIT_STATUSES = ['planned', 'in_progress'] as const

export function isClosedVisit(status: string) {
  return (CLOSED_VISIT_STATUSES as readonly string[]).includes(status)
}

export function isOpenVisit(status: string) {
  return (OPEN_VISIT_STATUSES as readonly string[]).includes(status)
}

/**
 * A Visit that didn't happen (ADR 0016, #157): it keeps its record, its
 * Charges are not done, and it doesn't count as work. It is read-only
 * until Office restores it, planned again.
 */
export function isCancelledVisit(status: string) {
  return status === 'cancelled'
}

/**
 * Whether the Visit counts as work for its Job (ADR 0013, 0016): neither a
 * Survey nor cancelled. A Job with one is in progress, and work complete
 * needs one. WORK_VISIT_SQL says the same in SQL.
 */
export function isWorkVisit(visit: { status: string; survey: boolean }) {
  return !visit.survey && !isCancelledVisit(visit.status)
}

/**
 * Whether Office can cancel the Visit (#157): one still planned or under
 * way, on a Job that takes new work. A closed or cancelled Job's Visits
 * don't change (ADR 0015).
 */
export function cancellableByOffice(jobActive: boolean, visitStatus: string) {
  return jobActive && isOpenVisit(visitStatus)
}

/**
 * Whether Office can restore the cancelled Visit, planned again (#157):
 * only on a Job that takes new work.
 */
export function restorableByOffice(jobActive: boolean, visitStatus: string) {
  return jobActive && isCancelledVisit(visitStatus)
}

/**
 * Whether Office marks the Visit done from the office pages: only one left
 * open when its Job was cancelled (#153). An active Job's Visits close in
 * the field; a closed Job is reopened first; a cancelled Visit didn't
 * happen.
 */
export function closableByOffice(jobStatus: string, visitStatus: string) {
  return jobStatus === 'cancelled' && isOpenVisit(visitStatus)
}

/**
 * Whether a Job has work on its Visits to invoice: hours or Items not
 * yet billed on a closed Visit. Work on open Visits waits for a later
 * Invoice, since those can still gain or lose hours and Items.
 */
export function hasBillableWork(visits: { status: string; unbilledLines: number }[]) {
  return visits.some((visit) => isClosedVisit(visit.status) && visit.unbilledLines > 0)
}
