import type Job from '#models/job'
import { deriveJobStatus } from '#services/job_status'

/**
 * A Job as shown in lists (Jobs, Customer and Site pages).
 */
export function jobRow(job: Job) {
  return {
    id: job.id,
    number: job.number,
    title: job.title,
    kind: job.kind,
    workCategory: job.workCategory,
    // Refined from the Visits when they are loaded (Work Complete)
    status:
      'visits' in job.$preloaded
        ? deriveJobStatus(
            job.status,
            job.visits.map((visit) => ({ status: visit.status, startsAt: visit.startsAt }))
          )
        : job.status,
    customer: job.customer ? { id: job.customer.id, displayName: job.customer.displayName } : null,
    site: job.site ? { id: job.site.id, summary: job.site.summary } : null,
    createdAt: job.createdAt.toISODate()!,
  }
}
