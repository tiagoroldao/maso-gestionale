import type { DateTime } from 'luxon'
import type { VisitStatus } from '#models/visit'
import type { JobIndicators } from '#shared/jobs'
import { isSettled } from '#shared/payment_status'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'

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
 * The indicators shown beside a Job's stored status (ADR 0015), whatever
 * that status is; WORK_COMPLETE_SQL, INVOICED_SQL and JOB_PAID_SQL say the
 * same in SQL:
 * - work complete: the Job has a work Visit and every Visit is finished,
 *   Surveys included, so nothing is left to do or to plan. A Job with only
 *   Surveys has had no work (ADR 0013);
 * - invoiced: an Invoice is past draft and nothing is left to bill
 *   (`billingOpen`, from BILLING_OPEN_SQL), every advance taken back;
 * - paid: an Invoice is past draft and every one is settled: nothing owed,
 *   and none overpaid (ADR 0014).
 */
export function jobIndicators(
  visits: VisitSummary[],
  invoices: InvoiceSummary[],
  billingOpen: boolean
): JobIndicators {
  const issued = invoices.filter((invoice) => invoice.status !== 'draft' && invoice.total)
  return {
    workComplete:
      visits.some((visit) => !visit.survey) && visits.every((visit) => isFinished(visit, visits)),
    invoiced: issued.length > 0 && !billingOpen,
    paid:
      issued.length > 0 &&
      issued.every((invoice) => isSettled({ total: invoice.total!, paid: invoice.paid })),
  }
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
export const UNSETTLED_SQL = `EXISTS (SELECT 1 FROM invoices i
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

/**
 * The Visit `alias` isn't finished (isFinished()): planned or under way,
 * or needing another visit with none planned after it.
 */
export const VISIT_TO_DO_SQL = (alias: string) => `(${alias}.status IN ('planned', 'in_progress')
  OR (${alias}.status = 'needs_return' AND NOT EXISTS (SELECT 1 FROM visits later
    WHERE later.job_id = ${alias}.job_id AND later.starts_at > ${alias}.starts_at)))`

/**
 * The indicators of jobIndicators() as SQL conditions, for the Jobs list's
 * filters: work complete, invoiced, paid, and all three (ready to close).
 */
export const WORK_COMPLETE_SQL = `(EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND NOT v.survey)
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND ${VISIT_TO_DO_SQL('v')}))`
export const INVOICED_SQL = `(${ISSUED_SQL} AND NOT ${BILLING_OPEN_SQL})`
export const JOB_PAID_SQL = `(${ISSUED_SQL} AND NOT ${UNSETTLED_SQL})`
export const READY_TO_CLOSE_SQL = `(${WORK_COMPLETE_SQL} AND ${INVOICED_SQL} AND ${JOB_PAID_SQL})`
