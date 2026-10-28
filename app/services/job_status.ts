import type { DateTime } from 'luxon'
import type { JobStatus } from '#models/job'
import type { VisitStatus } from '#models/visit'
import { isSettled } from '#shared/payment_status'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'

/**
 * The status shown for a Job: the stored status, refined from its Visits
 * (Work Complete) and its Invoices (Invoiced, then Closed once settled).
 */
export type DisplayedJobStatus = JobStatus | 'work_complete' | 'invoiced' | 'closed'

type InvoiceSummary = { status: string; total: string | null; paid: string }

type VisitSummary = { status: VisitStatus; startsAt: DateTime; survey: boolean }

/**
 * A Visit is finished when it is done, or when it needed another visit and
 * a later Visit exists for the Job.
 */
function isFinished(visit: VisitSummary, visits: VisitSummary[]) {
  if (visit.status === 'done') return true
  return visit.status === 'needs_return' && visits.some((other) => other.startsAt > visit.startsAt)
}

/**
 * Work Complete: the Job is in progress, it has a work Visit, and every
 * Visit is finished, Surveys included, so nothing is left to do or to
 * plan. A Job with only Surveys has had no work (ADR 0013).
 */
export function deriveJobStatus(
  stored: JobStatus,
  visits: VisitSummary[],
  invoices: InvoiceSummary[] = [],
  billingOpen = false
): DisplayedJobStatus {
  if (stored === 'cancelled') return stored
  // Invoiced once an Invoice is past draft and nothing is left to bill
  // (BILLING_OPEN_SQL); Closed when every Invoice is settled: nothing
  // owed, and none overpaid (ADR 0014)
  const issued = invoices.filter((invoice) => invoice.status !== 'draft' && invoice.total)
  if (issued.length && !billingOpen) {
    const settled = issued.every((invoice) =>
      isSettled({ total: invoice.total!, paid: invoice.paid })
    )
    return settled ? 'closed' : 'invoiced'
  }
  const workComplete =
    stored === 'in_progress' &&
    visits.some((visit) => !visit.survey) &&
    visits.every((visit) => isFinished(visit, visits))
  return workComplete ? 'work_complete' : stored
}

/**
 * The SQL equivalent of the Invoice `alias`'s Payments, refunds included.
 */
export const PAID_SQL = (alias: string) =>
  `(SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.invoice_id = ${alias}.id)`

/**
 * The SQL equivalent of owed() for the issued Invoice `alias`: below zero
 * when it is overpaid.
 */
export const OWED_SQL = (alias: string) => `(${alias}.total - ${PAID_SQL(alias)})`

/**
 * The same rules as SQL, for filtering Job lists: raw conditions on the
 * `jobs` table.
 */
const ISSUED_SQL = `EXISTS (SELECT 1 FROM invoices i
  WHERE i.job_id = jobs.id AND i.status <> 'draft')`
/** An issued Invoice not settled (isSettled()): something owed, or overpaid */
const UNSETTLED_SQL = `EXISTS (SELECT 1 FROM invoices i
  WHERE i.job_id = jobs.id AND i.status <> 'draft' AND ${OWED_SQL('i')} <> 0)`

/**
 * The SQL equivalents of chargeState() for the Charge `alias`: the latest
 * decision in its history ("not billable" or "billable"), the latest
 * billing event ("billed" or "unbilled"), and whether a draft holds it.
 */
export const NOT_BILLABLE_SQL = (alias: string) => `coalesce((SELECT e.kind = 'not_billable'
  FROM charge_events e
  WHERE e.charge_id = ${alias}.id AND e.kind IN ('not_billable', 'billable')
  ORDER BY e.id DESC LIMIT 1), false)`

const BILLED_SQL = (alias: string) => `coalesce((SELECT e.kind = 'billed'
  FROM charge_events e
  WHERE e.charge_id = ${alias}.id AND e.kind IN ('billed', 'unbilled')
  ORDER BY e.id DESC LIMIT 1), false)`

const IN_DRAFT_SQL = (alias: string) => `EXISTS (SELECT 1 FROM invoice_line_charges lc
  JOIN invoice_lines l ON l.id = lc.invoice_line_id
  JOIN invoices d ON d.id = l.invoice_id
  WHERE lc.charge_id = ${alias}.id AND d.status = 'draft')`

export const CHARGE_STATE_SQL = (alias: string) => `(CASE
  WHEN ${NOT_BILLABLE_SQL(alias)} THEN 'not_billable'
  WHEN ${BILLED_SQL(alias)} THEN 'billed'
  WHEN ${IN_DRAFT_SQL(alias)} THEN 'in_draft'
  ELSE 'to_bill' END)`

/**
 * Outstanding, as isOutstanding(): to bill, or only held by a draft.
 */
export const OUTSTANDING_SQL = (alias: string) =>
  `(NOT ${NOT_BILLABLE_SQL(alias)} AND NOT ${BILLED_SQL(alias)})`

/**
 * The SQL equivalent of isVisitBilled() for the Visit `alias`.
 */
export const VISIT_BILLED_SQL = (
  alias: string
) => `(${alias}.status IN (${CLOSED_VISIT_STATUSES.map((status) => `'${status}'`).join(', ')})
  AND NOT EXISTS (SELECT 1 FROM charges vc
    WHERE vc.visit_id = ${alias}.id AND ${OUTSTANDING_SQL('vc')}))`

/**
 * How much of the Advance Invoice `alias` issued Invoices took back, VAT
 * included.
 */
export const ADVANCE_DEDUCTED_SQL = (alias: string) => `(SELECT coalesce(sum(ad.amount), 0)
  FROM advance_deductions ad JOIN invoices di ON di.id = ad.invoice_id
  WHERE ad.advance_id = ${alias}.id AND di.status <> 'draft')`

/**
 * A Job still has something to bill, so an issued Invoice was a partial
 * one and the Job isn't Invoiced yet, whether or not it has a Quote (ADR
 * 0012):
 * - a Visit not billed (still open, or with outstanding Charges) or an
 *   outstanding Charge on the Job itself;
 * - an issued Advance Invoice not yet fully deducted by issued Invoices
 *   (advanceState()).
 */
export const BILLING_OPEN_SQL = `(
  EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND NOT ${VISIT_BILLED_SQL('v')})
  OR EXISTS (SELECT 1 FROM charges c
    WHERE c.job_id = jobs.id AND c.visit_id IS NULL AND ${OUTSTANDING_SQL('c')})
  OR EXISTS (SELECT 1 FROM invoices a
    WHERE a.job_id = jobs.id AND a.advance AND a.status <> 'draft'
      AND a.total > ${ADVANCE_DEDUCTED_SQL('a')}))`

const FULLY_INVOICED_SQL = `(${ISSUED_SQL} AND NOT ${BILLING_OPEN_SQL})`

export const CLOSED_SQL = `jobs.status <> 'cancelled' AND ${FULLY_INVOICED_SQL} AND NOT ${UNSETTLED_SQL}`
export const INVOICED_SQL = `jobs.status <> 'cancelled' AND ${FULLY_INVOICED_SQL} AND ${UNSETTLED_SQL}`
/** Not yet invoiced in full: what Work Complete and stored statuses describe */
export const NOT_INVOICED_SQL = `NOT ${FULLY_INVOICED_SQL}`

export const WORK_COMPLETE_SQL = `${NOT_INVOICED_SQL} AND jobs.status = 'in_progress'
  AND EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND NOT v.survey)
  AND NOT EXISTS (
    SELECT 1 FROM visits v
    WHERE v.job_id = jobs.id
      AND (v.status IN ('planned', 'in_progress')
        OR (v.status = 'needs_return' AND NOT EXISTS (
          SELECT 1 FROM visits later WHERE later.job_id = v.job_id AND later.starts_at > v.starts_at)))
  )`
