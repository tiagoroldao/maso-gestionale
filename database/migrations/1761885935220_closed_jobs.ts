import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The derived "closed" rule this migration replaces (#148, ADR 0014),
 * frozen here as it stood: not cancelled, an Invoice past draft, nothing
 * left to bill (every Visit closed with no outstanding Charge, no
 * outstanding Charge on the Job itself, every issued advance taken back),
 * and every issued Invoice settled: its Payments, refunds included, equal
 * its total.
 */
const outstanding = (alias: string) => `(
  NOT coalesce((SELECT e.kind = 'not_billable' FROM charge_events e
    WHERE e.charge_id = ${alias}.id AND e.kind IN ('not_billable', 'billable')
    ORDER BY e.id DESC LIMIT 1), false)
  AND NOT coalesce((SELECT e.kind = 'billed' FROM charge_events e
    WHERE e.charge_id = ${alias}.id AND e.kind IN ('billed', 'unbilled')
    ORDER BY e.id DESC LIMIT 1), false))`

const DERIVED_CLOSED = `jobs.status <> 'cancelled'
  AND EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = jobs.id AND i.status <> 'draft')
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id
    AND NOT (v.status IN ('done', 'needs_return')
      AND NOT EXISTS (SELECT 1 FROM charges vc WHERE vc.visit_id = v.id AND ${outstanding('vc')})))
  AND NOT EXISTS (SELECT 1 FROM charges c
    WHERE c.job_id = jobs.id AND c.visit_id IS NULL AND ${outstanding('c')})
  AND NOT EXISTS (SELECT 1 FROM invoices a
    WHERE a.job_id = jobs.id AND a.advance AND a.status <> 'draft'
      AND a.total > (SELECT coalesce(sum(ad.amount), 0)
        FROM advance_deductions ad JOIN invoices di ON di.id = ad.invoice_id
        WHERE ad.advance_id = a.id AND di.status <> 'draft'))
  AND NOT EXISTS (SELECT 1 FROM invoices i
    WHERE i.job_id = jobs.id AND i.status <> 'draft'
      AND i.total - (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.invoice_id = i.id) <> 0)`

/**
 * Closing a Job is something Office does (ADR 0015, #103): "closed" is a
 * stored status, with the date it was closed. Jobs that the derived rule
 * showed as closed are closed now, dated by their last Payment.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE jobs DROP CONSTRAINT jobs_status_check')
    this.schema.raw(
      "ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('open', 'in_progress', 'closed', 'cancelled'))"
    )
    this.schema.alterTable('jobs', (table) => {
      table.timestamp('closed_at').nullable()
    })
    this.schema.raw(`UPDATE jobs SET status = 'closed', closed_at = coalesce(
        (SELECT max(p.created_at) FROM payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE i.job_id = jobs.id),
        now())
      WHERE ${DERIVED_CLOSED}`)
  }

  async down() {
    // Closed Jobs follow their work again (ADR 0013); those still settled
    // show as closed by the derived rule
    this.schema.raw(`UPDATE jobs SET status = CASE
        WHEN EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND NOT v.survey)
        THEN 'in_progress' ELSE 'open' END
      WHERE status = 'closed'`)
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('closed_at')
    })
    this.schema.raw('ALTER TABLE jobs DROP CONSTRAINT jobs_status_check')
    this.schema.raw(
      "ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('open', 'in_progress', 'cancelled'))"
    )
  }
}
