/**
 * The kind of work, which with the Customer type and the Site decides the
 * default VAT on the Job's Invoice lines.
 */
export const WORK_CATEGORIES = [
  'new_installation',
  'maintenance',
  'renovation',
  'repair',
  'sale',
] as const
export type WorkCategory = (typeof WORK_CATEGORIES)[number]

/**
 * Statuses stored on the Job: open until a work Visit is planned, then in
 * progress (ADR 0013). Work Complete, Invoiced and Closed are worked out
 * from Visits, Invoices and Payments (job_status.ts). Quoted and accepted
 * are each Quote's own, not the Job's.
 */
export const JOB_STATUSES = ['open', 'in_progress', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/**
 * The Job list's filters, in the order shown: "active" (the default, no
 * filter in the URL), each status, Jobs by their Quotes (one waiting for
 * the Customer's answer, or one accepted), and "all".
 */
export const JOB_FILTERS = [
  'active',
  'open',
  'in_progress',
  'work_complete',
  'invoiced',
  'closed',
  'cancelled',
  'quote_sent',
  'quote_accepted',
  'all',
] as const
export type JobFilter = (typeof JOB_FILTERS)[number]
