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
 * progress (ADR 0013); closed and cancelled are set by Office (ADR 0015).
 * Quoted and accepted are each Quote's own, not the Job's.
 */
export const JOB_STATUSES = ['open', 'in_progress', 'closed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/**
 * The statuses of a Job that takes new work: Visits, Charges, Quotes and
 * field work. A closed or cancelled Job doesn't (ADR 0015), though Office
 * still bills the Charges already recorded on it (#111), and its Visits
 * leave the Agenda and the Technicians' lists.
 */
export const ACTIVE_JOB_STATUSES = ['open', 'in_progress'] as const satisfies JobStatus[]

export function takesNewWork(status: JobStatus) {
  return (ACTIVE_JOB_STATUSES as readonly JobStatus[]).includes(status)
}

/**
 * Shown beside a Job's status, worked out from its Visits, Invoices and
 * Payments (job_status.ts, ADR 0015): work complete (every work Visit
 * finished), invoiced (nothing left to bill, every advance taken back) and
 * paid (every issued Invoice settled).
 */
export type JobIndicators = { workComplete: boolean; invoiced: boolean; paid: boolean }

/**
 * The Job list's filters, in the order shown: "active" (the default, no
 * filter in the URL: open and in progress), each status, active Jobs by
 * their indicators ("ready to close": all three), Jobs by their Quotes
 * (one waiting for the Customer's answer, or one accepted), and "all".
 */
export const JOB_FILTERS = [
  'active',
  'open',
  'in_progress',
  'closed',
  'cancelled',
  'work_complete',
  'invoiced',
  'ready_to_close',
  'quote_sent',
  'quote_accepted',
  'all',
] as const
export type JobFilter = (typeof JOB_FILTERS)[number]
