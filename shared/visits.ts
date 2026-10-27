/**
 * Statuses that close a Visit: its Items are taken off stock and its
 * hours, Items, status and time become final. "Needs another visit" closes
 * this Visit too; the follow-up is a new Visit.
 */
export const CLOSED_VISIT_STATUSES: readonly string[] = ['done', 'needs_return']

export function isClosedVisit(status: string) {
  return CLOSED_VISIT_STATUSES.includes(status)
}
