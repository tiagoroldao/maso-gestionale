import type { DateTime } from 'luxon'
import type { VisitStatus } from '#shared/visits'
import type { JobIndicators } from '#shared/jobs'
import { isSettled } from '#shared/payment_status'
import { CLOSED_VISIT_STATUSES, isCancelledVisit, isWorkVisit } from '#shared/visits'
import { BILLING_EVENT_KINDS, WORK_EVENT_KINDS } from '#shared/charges'

type InvoiceSummary = { status: string; total: string | null; credited: string; paid: string }

type VisitSummary = { status: VisitStatus; startsAt: DateTime; survey: boolean }

/**
 * A Visit is finished when it is done, or when it needed another visit and
 * a later Visit exists for the Job (among `visits`, from which the caller
 * leaves cancelled ones out).
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
 *   Surveys has had no work (ADR 0013). Cancelled Visits don't count at
 *   all (ADR 0016): neither as work nor as a follow-up;
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
  const counted = visits.filter((visit) => !isCancelledVisit(visit.status))
  const issued = invoices.filter((invoice) => invoice.status !== 'draft' && invoice.total)
  return {
    workComplete: counted.some(isWorkVisit) && counted.every((visit) => isFinished(visit, counted)),
    invoiced: issued.length > 0 && !billingOpen,
    paid:
      issued.length > 0 &&
      issued.every((invoice) =>
        isSettled({ total: invoice.total!, credited: invoice.credited, paid: invoice.paid })
      ),
  }
}

/**
 * The SQL equivalent of the Invoice `alias`'s Payments, refunds included.
 */
export const PAID_SQL = (alias: string) =>
  `(SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.invoice_id = ${alias}.id)`

/**
 * The SQL equivalent of the Invoice `alias`'s Credit Notes, as credits()
 * counts them: every one past draft.
 */
export const CREDITED_SQL = (alias: string) => `(SELECT coalesce(sum(cn.total), 0) FROM invoices cn
  WHERE cn.credits_invoice_id = ${alias}.id AND cn.status <> 'draft')`

/**
 * The SQL equivalent of owed() for the issued Invoice `alias`: below zero
 * when it is overpaid.
 */
export const OWED_SQL = (alias: string) =>
  `(${alias}.total - ${CREDITED_SQL(alias)} - ${PAID_SQL(alias)})`

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
 * billing event (BILLING_EVENT_KINDS), and whether a draft holds it.
 */
export const NOT_BILLABLE_SQL = (alias: string) => `coalesce((SELECT e.kind = 'not_billable'
  FROM charge_events e
  WHERE e.charge_id = ${alias}.id AND e.kind IN ('not_billable', 'billable')
  ORDER BY e.id DESC LIMIT 1), false)`

const LATEST_BILLING_SQL = (alias: string) => `coalesce((SELECT e.kind
  FROM charge_events e
  WHERE e.charge_id = ${alias}.id
    AND e.kind IN (${BILLING_EVENT_KINDS.map((kind) => `'${kind}'`).join(', ')})
  ORDER BY e.id DESC LIMIT 1), 'none')`

const IN_DRAFT_SQL = (alias: string) => `EXISTS (SELECT 1 FROM invoice_line_charges lc
  JOIN invoice_lines l ON l.id = lc.invoice_line_id
  JOIN invoices d ON d.id = l.invoice_id
  WHERE lc.charge_id = ${alias}.id AND d.status = 'draft')`

export const CHARGE_STATE_SQL = (alias: string) => `(CASE
  WHEN ${NOT_BILLABLE_SQL(alias)} THEN 'not_billable'
  ELSE (CASE ${LATEST_BILLING_SQL(alias)}
    WHEN 'billed' THEN 'billed'
    WHEN 'uncredited' THEN 'billed'
    WHEN 'credited' THEN 'credited'
    ELSE (CASE WHEN ${IN_DRAFT_SQL(alias)} THEN 'in_draft' ELSE 'to_bill' END) END) END)`

/**
 * The SQL equivalent of workState() for the Charge `alias`: its latest
 * work event, or planned before any (ADR 0016).
 */
export const WORK_STATE_SQL = (alias: string) => `coalesce((SELECT e.kind
  FROM charge_events e
  WHERE e.charge_id = ${alias}.id
    AND e.kind IN (${WORK_EVENT_KINDS.map((kind) => `'${kind}'`).join(', ')})
  ORDER BY e.id DESC LIMIT 1), 'planned')`

/**
 * Outstanding, as isOutstanding(): to bill, or only held by a draft; not
 * billed by an issued Invoice nor credited, and not "not done" (planned
 * work keeps billing open).
 */
export const OUTSTANDING_SQL = (alias: string) =>
  `(NOT ${NOT_BILLABLE_SQL(alias)}
    AND ${LATEST_BILLING_SQL(alias)} NOT IN ('billed', 'uncredited', 'credited')
    AND ${WORK_STATE_SQL(alias)} <> 'not_done')`

/**
 * An issued Invoice line bills the Charge `alias` and no Credit Notes
 * credited that line in full (creditedInFull()): its work state and
 * recorded quantity are frozen, even once Office sets it back to bill
 * (ADR 0016). Only Credit Notes SDI delivered (or couldn't deliver) count:
 * one merely finalised may still be rejected and corrected below the line,
 * giving the Charge its billing back. A draft's line doesn't freeze it,
 * nor does a line removed from a rejected Invoice, whose link goes with it.
 */
export const WORK_FROZEN_SQL = (alias: string) => `EXISTS (SELECT 1 FROM invoice_line_charges flc
  JOIN invoice_lines fl ON fl.id = flc.invoice_line_id
  JOIN invoices fi ON fi.id = fl.invoice_id
  WHERE flc.charge_id = ${alias}.id AND fi.status <> 'draft'
    AND NOT coalesce((SELECT sum(cl.line_total) >= fl.line_total FROM invoice_lines cl
      JOIN invoices cn ON cn.id = cl.invoice_id
      WHERE cl.credits_line_id = fl.id
        AND cn.status IN ('delivered', 'not_deliverable')), false))`

/**
 * The SQL equivalent of isVisitBilled() for the Visit `alias`: closed or
 * cancelled (its Charges then all not done), with nothing outstanding.
 */
const SETTLED_VISIT_STATUSES = [...CLOSED_VISIT_STATUSES, 'cancelled']
export const VISIT_BILLED_SQL = (
  alias: string
) => `(${alias}.status IN (${SETTLED_VISIT_STATUSES.map((status) => `'${status}'`).join(', ')})
  AND NOT EXISTS (SELECT 1 FROM charges vc
    WHERE vc.visit_id = ${alias}.id AND ${OUTSTANDING_SQL('vc')}))`

/**
 * A deduction `ad` (of advance_deductions) a Credit Note past draft gives
 * back: it credits the deducting Invoice's lines taking back that advance
 * (ADR 0014; Invoices.save makes it credit all of them or none).
 */
export const DEDUCTION_REVERSED_SQL = (ad: string) => `EXISTS (SELECT 1 FROM invoice_lines fl
  JOIN invoice_lines rl ON rl.credits_line_id = fl.id
  JOIN invoices rn ON rn.id = rl.invoice_id
  WHERE fl.invoice_id = ${ad}.invoice_id AND fl.deducts_invoice_id = ${ad}.advance_id
    AND rn.status <> 'draft')`

/**
 * How much of the Advance Invoice `alias` issued Invoices took back, VAT
 * included: their deductions, less those a Credit Note gave back.
 */
export const ADVANCE_DEDUCTED_SQL = (alias: string) => `(SELECT coalesce(sum(ad.amount), 0)
  FROM advance_deductions ad JOIN invoices di ON di.id = ad.invoice_id
  WHERE ad.advance_id = ${alias}.id AND di.status <> 'draft'
    AND NOT ${DEDUCTION_REVERSED_SQL('ad')})`

/**
 * How much of the Advance Invoice `alias` is taken back, as advanceState()
 * and advanceLeft() count it: deducted by issued Invoices, or credited by
 * its Credit Notes past draft (ADR 0014).
 */
export const ADVANCE_TAKEN_BACK_SQL = (alias: string) =>
  `(${ADVANCE_DEDUCTED_SQL(alias)} + ${CREDITED_SQL(alias)})`

/**
 * A Job still has something to bill, so an issued Invoice was a partial
 * one and the Job isn't Invoiced yet, whether or not it has a Quote (ADR
 * 0012):
 * - a Visit not billed (still open, or with outstanding Charges) or an
 *   outstanding Charge on the Job itself (a credited or not done one
 *   isn't; a planned one is, its work still to come, ADR 0016);
 * - an issued Advance Invoice not yet fully taken back by issued Invoices
 *   and Credit Notes (advanceState()).
 */
export const BILLING_OPEN_SQL = `(
  EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND NOT ${VISIT_BILLED_SQL('v')})
  OR EXISTS (SELECT 1 FROM charges c
    WHERE c.job_id = jobs.id AND c.visit_id IS NULL AND ${OUTSTANDING_SQL('c')})
  OR EXISTS (SELECT 1 FROM invoices a
    WHERE a.job_id = jobs.id AND a.advance AND a.status <> 'draft'
      AND a.total > ${ADVANCE_TAKEN_BACK_SQL('a')}))`

/**
 * The Visit `alias` isn't finished (isFinished()): planned or under way,
 * or needing another visit with none planned after it (a cancelled one is
 * no follow-up). A cancelled Visit is never to do.
 */
export const VISIT_TO_DO_SQL = (alias: string) => `(${alias}.status IN ('planned', 'in_progress')
  OR (${alias}.status = 'needs_return' AND NOT EXISTS (SELECT 1 FROM visits later
    WHERE later.job_id = ${alias}.job_id AND later.starts_at > ${alias}.starts_at
      AND later.status <> 'cancelled')))`

/**
 * The Visit `alias` counts as work for its Job (isWorkVisit()): neither a
 * Survey nor cancelled.
 */
export const WORK_VISIT_SQL = (alias: string) =>
  `(NOT ${alias}.survey AND ${alias}.status <> 'cancelled')`

/**
 * The indicators of jobIndicators() as SQL conditions, for the Jobs list's
 * filters: work complete, invoiced, paid, and all three (ready to close).
 */
export const WORK_COMPLETE_SQL = `(EXISTS (SELECT 1 FROM visits v
    WHERE v.job_id = jobs.id AND ${WORK_VISIT_SQL('v')})
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND ${VISIT_TO_DO_SQL('v')}))`
export const INVOICED_SQL = `(${ISSUED_SQL} AND NOT ${BILLING_OPEN_SQL})`
export const JOB_PAID_SQL = `(${ISSUED_SQL} AND NOT ${UNSETTLED_SQL})`
export const READY_TO_CLOSE_SQL = `(${WORK_COMPLETE_SQL} AND ${INVOICED_SQL} AND ${JOB_PAID_SQL})`
