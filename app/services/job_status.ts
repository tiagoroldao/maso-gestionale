import Big from 'big.js'
import type { DateTime } from 'luxon'
import type { JobStatus } from '#models/job'
import type { VisitStatus } from '#models/visit'

/**
 * The status shown for a Job: the stored status, refined from its Visits
 * (Work Complete) and its Invoices (Invoiced, then Closed once paid).
 */
export type DisplayedJobStatus = JobStatus | 'work_complete' | 'invoiced' | 'closed'

type InvoiceSummary = { status: string; total: string | null; paid: string }

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
export function deriveJobStatus(
  stored: JobStatus,
  visits: VisitSummary[],
  invoices: InvoiceSummary[] = [],
  billingOpen = false
): DisplayedJobStatus {
  if (stored === 'cancelled') return stored
  // Invoiced once an Invoice is past draft and nothing is left to bill
  // (BILLING_OPEN_SQL); Closed when every Invoice is paid
  const issued = invoices.filter((invoice) => invoice.status !== 'draft' && invoice.total)
  if (issued.length && !billingOpen) {
    const paid = issued.every((invoice) => new Big(invoice.paid).gte(invoice.total!))
    return paid ? 'closed' : 'invoiced'
  }
  const workComplete =
    stored === 'in_progress' &&
    visits.length > 0 &&
    visits.every((visit) => isFinished(visit, visits))
  return workComplete ? 'work_complete' : stored
}

/**
 * The same rules as SQL, for filtering Job lists: raw conditions on the
 * `jobs` table.
 */
const ISSUED_SQL = `EXISTS (SELECT 1 FROM invoices i
  WHERE i.job_id = jobs.id AND i.status <> 'draft')`
const UNPAID_SQL = `EXISTS (SELECT 1 FROM invoices i
  WHERE i.job_id = jobs.id AND i.status <> 'draft'
    AND i.total > (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.invoice_id = i.id))`

/**
 * A Job still has something to bill, so an issued Invoice was a partial
 * one and the Job isn't Invoiced yet:
 * - a Time & Materials Job with a Visit not yet closed, or hours or Items
 *   no Invoice billed yet or only a draft holds;
 * - any Job with an issued Advance Invoice not yet taken back on an issued
 *   Invoice (its final Invoice is still to come, or still a draft).
 */
const unbilled = (table: string) => `EXISTS (SELECT 1 FROM ${table} w
    JOIN visits v ON v.id = w.visit_id
    LEFT JOIN invoices bi ON bi.id = w.invoice_id
    WHERE v.job_id = jobs.id AND (w.invoice_id IS NULL OR bi.status = 'draft'))`
export const BILLING_OPEN_SQL = `((jobs.kind = 'time_and_materials' AND (
  EXISTS (SELECT 1 FROM visits v
    WHERE v.job_id = jobs.id AND v.status IN ('planned', 'in_progress'))
  OR ${unbilled('visit_hours')}
  OR ${unbilled('visit_items')}))
  OR EXISTS (SELECT 1 FROM invoices a
    LEFT JOIN invoices fi ON fi.id = a.deducted_in_id
    WHERE a.job_id = jobs.id AND a.advance AND a.status <> 'draft'
      AND (a.deducted_in_id IS NULL OR fi.status = 'draft')))`

const FULLY_INVOICED_SQL = `(${ISSUED_SQL} AND NOT ${BILLING_OPEN_SQL})`

export const CLOSED_SQL = `jobs.status <> 'cancelled' AND ${FULLY_INVOICED_SQL} AND NOT ${UNPAID_SQL}`
export const INVOICED_SQL = `jobs.status <> 'cancelled' AND ${FULLY_INVOICED_SQL} AND ${UNPAID_SQL}`
/** Not yet invoiced in full: what Work Complete and stored statuses describe */
export const NOT_INVOICED_SQL = `NOT ${FULLY_INVOICED_SQL}`

export const WORK_COMPLETE_SQL = `${NOT_INVOICED_SQL} AND jobs.status = 'in_progress'
  AND EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id)
  AND NOT EXISTS (
    SELECT 1 FROM visits v
    WHERE v.job_id = jobs.id
      AND (v.status IN ('planned', 'in_progress')
        OR (v.status = 'needs_return' AND NOT EXISTS (
          SELECT 1 FROM visits later WHERE later.job_id = v.job_id AND later.starts_at > v.starts_at)))
  )`
