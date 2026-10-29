import Job from '#models/job'
import { jobIndicators } from '#services/job_status'

/** How many Jobs the Customer and Site pages show; the rest are on the filtered Jobs list */
export const RECENT_JOBS = 25

/**
 * A Customer's or a Site's newest Jobs, at most `RECENT_JOBS`, as rows,
 * with how many it has in all.
 */
export async function recentJobs(owner: { customerId: number } | { siteId: number }) {
  const query = Job.query()
    .withScopes((scopes) => scopes.withBillingState())
    .preload('customer')
    .preload('site')
    .preload('visits')
    .preload('invoices', (invoices) => invoices.preload('payments').preload('creditNotes'))
    .orderBy([
      { column: 'year', order: 'desc' },
      { column: 'sequence', order: 'desc' },
    ])
  if ('customerId' in owner) query.where('customerId', owner.customerId)
  else query.where('siteId', owner.siteId)
  const results = await query.paginate(1, RECENT_JOBS)
  return { rows: results.all().map((job) => jobRow(job)), total: results.total }
}

/**
 * A Job as shown in lists (Jobs, Customer and Site pages): its stored
 * status, and the indicators beside it (ADR 0015) when its Visits and its
 * Invoices with their Payments and Credit Notes are preloaded, with the `withBillingState`
 * scope; null otherwise.
 */
export function jobRow(job: Job) {
  return {
    id: job.id,
    number: job.number,
    title: job.title,
    workCategory: job.workCategory,
    status: job.status,
    indicators: indicatorsOf(job),
    customer: job.customer ? { id: job.customer.id, displayName: job.customer.displayName } : null,
    site: job.site ? { id: job.site.id, summary: job.site.summary } : null,
    createdAt: job.createdAt.toISODate()!,
  }
}

function indicatorsOf(job: Job) {
  if (!('visits' in job.$preloaded) || !('invoices' in job.$preloaded)) return null
  // Without the billing state a partly invoiced Job would look invoiced
  if (!('billing_open' in job.$extras)) {
    throw new Error('Job indicators need the withBillingState scope')
  }
  return jobIndicators(
    job.visits.map((visit) => ({
      status: visit.status,
      startsAt: visit.startsAt,
      survey: visit.survey,
    })),
    job.invoices.map((invoice) => ({
      status: invoice.status,
      total: invoice.total,
      credited: invoice.credited,
      paid: invoice.paid,
    })),
    Boolean(job.$extras.billing_open)
  )
}
