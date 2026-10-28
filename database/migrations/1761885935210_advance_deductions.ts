import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Advance deductions set by Office (#116, ADR 0011): any Job Invoice takes
 * back part or all of any issued Advance Invoice, an amount VAT included,
 * replacing `invoices.deducted_in_id` (one final Invoice taking each
 * advance back in full, #23).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('advance_deductions', (table) => {
      table.increments('id').notNullable()
      table
        .integer('invoice_id')
        .notNullable()
        .references('id')
        .inTable('invoices')
        .onDelete('CASCADE')
      table
        .integer('advance_id')
        .notNullable()
        .references('id')
        .inTable('invoices')
        .onDelete('RESTRICT')
      // VAT included, split over the advance's VAT rows by the deduction lines
      table.decimal('amount', 14, 2).notNullable()
      table.timestamp('created_at').notNullable()
      table.check('amount > 0')
      table.check('invoice_id <> advance_id', [], 'advance_deductions_other_invoice_check')
      table.unique(['invoice_id', 'advance_id'])
      table.index(['advance_id'])
    })
    // Each advance was taken back in full by the Invoice deducting it
    this.schema.raw(`
      INSERT INTO advance_deductions (invoice_id, advance_id, amount, created_at)
      SELECT a.deducted_in_id, a.id, a.total, now()
      FROM invoices a
      WHERE a.advance AND a.deducted_in_id IS NOT NULL AND a.total > 0
      ORDER BY a.id`)
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_advance_check')
    this.schema.alterTable('invoices', (table) => {
      table.dropColumn('deducted_in_id')
    })
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_advance_check
      CHECK (NOT advance OR job_id IS NOT NULL)`)
  }

  async down() {
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_advance_check')
    this.schema.alterTable('invoices', (table) => {
      table
        .integer('deducted_in_id')
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('SET NULL')
    })
    // The latest Invoice deducting each advance; partial deductions can't
    // be told apart
    this.schema.raw(`
      UPDATE invoices a SET deducted_in_id = (
        SELECT d.invoice_id FROM advance_deductions d
        WHERE d.advance_id = a.id ORDER BY d.invoice_id DESC LIMIT 1)
      WHERE a.advance`)
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_advance_check
      CHECK ((NOT advance OR job_id IS NOT NULL) AND (deducted_in_id IS NULL OR advance))`)
    this.schema.dropTable('advance_deductions')
  }
}
