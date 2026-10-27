import type { DateTime } from 'luxon'
import type { JobStatus } from '#models/job'
import type { VisitStatus } from '#models/visit'

/**
 * The status shown for a Job: the stored status, refined from its Visits.
 * Invoiced and Closed come with invoicing.
 */
export type DisplayedJobStatus = JobStatus | 'work_complete'

type VisitSummary = { status: VisitStatus; startsAt: DateTime }

/**
 * A Visit is finished when it is done, or when it needed another visit and
 * a later Visit exists for the Job.
 */
function isFinished(visit: VisitSummary, visits: VisitSummary[]) {
  if (visit.status === 'done') return true
  return visit.status === 'needs_return' && visits.some((other) => other.startsAt > visit.startsAt)
}

/**
 * Work Complete: the Job is in progress and every Visit is finished, so
 * nothing is left to do or to plan.
 */
export function deriveJobStatus(stored: JobStatus, visits: VisitSummary[]): DisplayedJobStatus {
  const workComplete =
    stored === 'in_progress' &&
    visits.length > 0 &&
    visits.every((visit) => isFinished(visit, visits))
  return workComplete ? 'work_complete' : stored
}

/**
 * The same rule as SQL, for filtering Job lists: a raw condition on the
 * `jobs` table.
 */
export const WORK_COMPLETE_SQL = `jobs.status = 'in_progress'
  AND EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id)
  AND NOT EXISTS (
    SELECT 1 FROM visits v
    WHERE v.job_id = jobs.id
      AND (v.status IN ('planned', 'in_progress')
        OR (v.status = 'needs_return' AND NOT EXISTS (
          SELECT 1 FROM visits later WHERE later.job_id = v.job_id AND later.starts_at > v.starts_at)))
  )`
