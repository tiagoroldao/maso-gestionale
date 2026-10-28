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
    workCategory: job.workCategory,
    // Refined from the Visits and Invoices when loaded (Work Complete,
    // Invoiced, Closed); Invoices need their Payments and Credit Notes
    // preloaded
    status:
      'visits' in job.$preloaded
        ? deriveJobStatus(
            job.status,
            job.visits.map((visit) => ({
              status: visit.status,
              startsAt: visit.startsAt,
              survey: visit.survey,
            })),
            'invoices' in job.$preloaded
              ? job.invoices.map((invoice) => ({
                  status: invoice.status,
                  total: invoice.total,
                  credited: invoice.credited,
                  paid: invoice.paid,
                }))
              : [],
            Boolean(job.$extras.billing_open)
          )
        : job.status,
    customer: job.customer ? { id: job.customer.id, displayName: job.customer.displayName } : null,
    site: job.site ? { id: job.site.id, summary: job.site.summary } : null,
    createdAt: job.createdAt.toISODate()!,
  }
}
