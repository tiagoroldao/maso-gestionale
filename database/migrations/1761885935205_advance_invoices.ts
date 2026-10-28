import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('invoices', (table) => {
      // An Advance Invoice (FatturaPA TD02) bills part of a Job up front
      table.boolean('advance').notNullable().defaultTo(false)
      // The Invoice whose deduction line takes this advance back; freed if
      // that draft is deleted
      table
        .integer('deducted_in_id')
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('SET NULL')
    })
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_advance_check
      CHECK ((NOT advance OR job_id IS NOT NULL) AND (deducted_in_id IS NULL OR advance))`)
    // A deduction line takes back an advance: a negative price, never an Item
    this.schema.raw('ALTER TABLE invoice_lines DROP CONSTRAINT invoice_lines_unit_price_check')
    this.schema.raw(`ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_unit_price_check
      CHECK (unit_price >= 0 OR item_id IS NULL)`)
  }

  async down() {
    this.schema.raw('ALTER TABLE invoice_lines DROP CONSTRAINT invoice_lines_unit_price_check')
    this.schema.raw(
      'ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_unit_price_check CHECK (unit_price >= 0)'
    )
    this.schema.alterTable('invoices', (table) => {
      table.dropChecks(['invoices_advance_check'])
      table.dropColumns('advance', 'deducted_in_id')
    })
  }
}
