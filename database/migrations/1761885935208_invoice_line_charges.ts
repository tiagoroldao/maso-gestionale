import { BaseSchema } from '@adonisjs/lucid/schema'

const OLD_KINDS = ['recorded', 'corrected', 'billing_edited', 'not_billable', 'billable']
const KINDS = [...OLD_KINDS, 'billed', 'unbilled']
const kindCheck = (kinds: string[]) =>
  `ALTER TABLE charge_events ADD CONSTRAINT charge_events_kind_check
   CHECK (kind IN (${kinds.map((kind) => `'${kind}'`).join(', ')}))`

/**
 * Invoicing from Charges (#116, ADR 0010): an Invoice line records the
 * Charges it bills, replacing the per-Invoice link from #75. A draft only
 * holds them; finalising adds a "billed" event to each, with the line and
 * the amount billed, and Office can set a billed Charge back to "to bill"
 * ("unbilled").
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('invoice_line_charges', (table) => {
      table.increments('id').notNullable()
      table
        .integer('invoice_line_id')
        .notNullable()
        .references('id')
        .inTable('invoice_lines')
        .onDelete('CASCADE')
      table.integer('charge_id').notNullable().references('id').inTable('charges')
      table.timestamp('created_at').notNullable()
      table.unique(['invoice_line_id', 'charge_id'])
      table.index(['charge_id'])
    })

    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck(KINDS))
    this.schema.alterTable('charge_events', (table) => {
      // The Invoice that billed the Charge, or whose billing was undone
      table.integer('invoice_id').nullable().references('id').inTable('invoices')
      // No foreign key: correcting a rejected Invoice may remove the line,
      // which records an "unbilled" event
      table.integer('invoice_line_id').nullable()
      // The Charge's part of the line's amount (before the global discount)
      table.decimal('amount', 14, 2).nullable()
      table.check(
        `(kind IN ('billed', 'unbilled')) = (invoice_id IS NOT NULL)
          AND (kind = 'billed') = (amount IS NOT NULL)`,
        [],
        'charge_events_billing_check'
      )
      table.index(['invoice_id'])
    })

    // Charges a draft held become its lines' Charges; Charges an issued
    // Invoice billed get their "billed" event. A Charge is matched to the
    // line drafted from it: same description (less the day), quantity and
    // price, in order. A Charge whose line Office changed or removed can't
    // be matched: in a draft it is released, on an issued Invoice it is
    // billed without a line.
    this.schema.raw(`
      CREATE TABLE charge_lines AS
      WITH c AS (
        SELECT c.id, c.invoice_id, c.bill_quantity, c.unit_price, c.description,
          lineTotal, row_number() OVER (
            PARTITION BY c.invoice_id, c.description, c.bill_quantity, c.unit_price
            ORDER BY c.id) AS n
        FROM charges c,
          LATERAL (SELECT round(c.bill_quantity * c.unit_price, 2) AS lineTotal) t
        WHERE c.invoice_id IS NOT NULL
      ), l AS (
        SELECT l.id, l.invoice_id, l.quantity, l.unit_price, l.line_total,
          regexp_replace(l.description, ' \\(\\d\\d/\\d\\d\\)$', '') AS description,
          row_number() OVER (
            PARTITION BY l.invoice_id, regexp_replace(l.description, ' \\(\\d\\d/\\d\\d\\)$', ''),
              l.quantity, l.unit_price
            ORDER BY l.position, l.id) AS n
        FROM invoice_lines l
        WHERE l.deducts_invoice_id IS NULL
      )
      SELECT c.id AS charge_id, c.invoice_id, l.id AS line_id,
        coalesce(l.line_total, c.lineTotal) AS amount
      FROM c
      LEFT JOIN l ON l.invoice_id = c.invoice_id AND l.description = c.description
        AND l.quantity = c.bill_quantity AND l.unit_price = c.unit_price AND l.n = c.n`)
    this.schema.raw(`
      INSERT INTO invoice_line_charges (invoice_line_id, charge_id, created_at)
      SELECT line_id, charge_id, now() FROM charge_lines WHERE line_id IS NOT NULL
      ORDER BY charge_id`)
    this.schema.raw(`
      INSERT INTO charge_events (charge_id, kind, user_id, invoice_id, invoice_line_id, amount,
        created_at)
      SELECT cl.charge_id, 'billed', NULL, cl.invoice_id, cl.line_id, cl.amount,
        coalesce(i.finalised_at, now())
      FROM charge_lines cl
      JOIN invoices i ON i.id = cl.invoice_id
      WHERE i.status <> 'draft'
      ORDER BY cl.charge_id`)

    this.schema.raw('DROP TABLE charge_lines')
    this.schema.alterTable('charges', (table) => {
      table.dropColumn('invoice_id')
    })
  }

  async down() {
    this.schema.alterTable('charges', (table) => {
      table
        .integer('invoice_id')
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('SET NULL')
      table.index(['invoice_id'])
    })
    // The Invoice billing the Charge now, or the draft holding it
    this.schema.raw(`
      UPDATE charges c SET invoice_id = coalesce(
        (SELECT CASE WHEN e.kind = 'billed' THEN e.invoice_id END FROM charge_events e
          WHERE e.charge_id = c.id AND e.kind IN ('billed', 'unbilled')
          ORDER BY e.id DESC LIMIT 1),
        (SELECT l.invoice_id FROM invoice_line_charges lc
          JOIN invoice_lines l ON l.id = lc.invoice_line_id
          JOIN invoices i ON i.id = l.invoice_id
          WHERE lc.charge_id = c.id AND i.status = 'draft' LIMIT 1))`)
    this.schema.raw(`DELETE FROM charge_events WHERE kind IN ('billed', 'unbilled')`)
    this.schema.alterTable('charge_events', (table) => {
      table.dropChecks(['charge_events_billing_check'])
      table.dropColumn('amount')
      table.dropColumn('invoice_line_id')
      table.dropColumn('invoice_id')
    })
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck(OLD_KINDS))
    this.schema.dropTable('invoice_line_charges')
  }
}
