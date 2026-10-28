/**
 * Statuses that close a Visit: its Items are taken off stock and its
 * hours, Items, status and time become final. "Needs another visit" closes
 * this Visit too; the follow-up is a new Visit.
 */
export const CLOSED_VISIT_STATUSES: readonly string[] = ['done', 'needs_return']

export function isClosedVisit(status: string) {
  return CLOSED_VISIT_STATUSES.includes(status)
}

/**
 * Whether Office marks the Visit done from the office pages: only one left
 * open when its Job was cancelled (#153). An active Job's Visits close in
 * the field; a closed Job is reopened first.
 */
export function closableByOffice(jobStatus: string, visitStatus: string) {
  return jobStatus === 'cancelled' && !isClosedVisit(visitStatus)
}

/**
 * Whether a Job has work on its Visits to invoice: hours or Items not
 * yet billed on a closed Visit. Work on open Visits waits for a later
 * Invoice, since those can still gain or lose hours and Items.
 */
export function hasBillableWork(visits: { status: string; unbilledLines: number }[]) {
  return visits.some((visit) => isClosedVisit(visit.status) && visit.unbilledLines > 0)
}
