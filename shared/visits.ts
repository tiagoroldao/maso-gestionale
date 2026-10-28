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
 * Whether a Time & Materials Job's recorded work can be invoiced: there is
 * some, and every Visit holding work is closed (open Visits can still gain
 * or lose hours and Items).
 */
export function workReadyToInvoice(visits: { status: string; workLines: number }[]) {
  const withWork = visits.filter((visit) => visit.workLines > 0)
  return withWork.length > 0 && withWork.every((visit) => isClosedVisit(visit.status))
}
