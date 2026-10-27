import type { JobStatus } from '#models/job'
import type { VisitStatus } from '#models/visit'

/**
 * The status shown for a Job: the stored status, refined from its Visits.
 * Work Complete means work started and every Visit is done, with none
 * needing another visit. Invoiced and Closed come with invoicing.
 */
export type DisplayedJobStatus = JobStatus | 'work_complete'

export function deriveJobStatus(
  stored: JobStatus,
  visitStatuses: VisitStatus[]
): DisplayedJobStatus {
  const workComplete =
    stored === 'in_progress' &&
    visitStatuses.length > 0 &&
    visitStatuses.every((status) => status === 'done')
  return workComplete ? 'work_complete' : stored
}
