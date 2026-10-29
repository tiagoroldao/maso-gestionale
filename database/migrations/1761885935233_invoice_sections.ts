import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * An Invoice's sections (#184, ADR 0018): headings that order and frame
 * its lines on the PDF, each with a title and whether it shows a
 * subtotal. A line belongs to at most one; lines outside any sit at the
 * top. They go with the Invoice, and a line whose section is removed
 * stays, outside any.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('invoice_sections', (table) => {
      table.increments('id').notNullable()
      table
        .integer('invoice_id')
        .notNullable()
        .references('id')
        .inTable('invoices')
        .onDelete('CASCADE')
      table.integer('position').notNullable()
      table.string('title', 200).notNullable()
      table.boolean('show_subtotal').notNullable().defaultTo(true)
      table.index(['invoice_id'])
    })
    this.schema.alterTable('invoice_lines', (table) => {
      table
        .integer('section_id')
        .nullable()
        .references('id')
        .inTable('invoice_sections')
        .onDelete('SET NULL')
      table.index(['section_id'])
    })
  }

  async down() {
    this.schema.alterTable('invoice_lines', (table) => {
      table.dropColumn('section_id')
    })
    this.schema.dropTable('invoice_sections')
  }
}
