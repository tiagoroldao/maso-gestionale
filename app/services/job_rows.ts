import type Job from '#models/job'

/**
 * A Job as shown in lists (Jobs, Customer and Site pages).
 */
export function jobRow(job: Job) {
  return {
    id: job.id,
    number: job.number,
    title: job.title,
    kind: job.kind,
    status: job.status,
    customer: job.customer ? { id: job.customer.id, displayName: job.customer.displayName } : null,
    site: job.site ? { id: job.site.id, summary: job.site.summary } : null,
    createdAt: job.createdAt.toISODate()!,
  }
}
