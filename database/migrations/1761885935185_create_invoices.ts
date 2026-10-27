import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('invoices', (table) => {
      table.increments('id').notNullable()
      table
        .integer('customer_id')
        .notNullable()
        .references('id')
        .inTable('customers')
        .onDelete('RESTRICT')
        .index()
      // Finalising (#19) adds the later states, the number and the date
      table.enum('status', ['draft']).notNullable().defaultTo('draft')
      // Global discount, applied before VAT and split across the rates
      table.decimal('discount_percent', 5, 2).notNullable().defaultTo(0)
      table.check('discount_percent >= 0 AND discount_percent < 100')
      table.text('notes').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('invoice_lines', (table) => {
      table.increments('id').notNullable()
      table
        .integer('invoice_id')
        .notNullable()
        .references('id')
        .inTable('invoices')
        .onDelete('CASCADE')
      table.integer('position').notNullable()
      // Free-text lines have no Item
      table.integer('item_id').nullable().references('id').inTable('items').onDelete('RESTRICT')
      table.string('description', 1000).notNullable()
      table.decimal('quantity', 14, 3).notNullable()
      table.check('quantity > 0')
      table.string('unit', 10).nullable()
      table.decimal('unit_price', 14, 4).notNullable()
      table.check('unit_price >= 0')
      table.decimal('discount_percent', 5, 2).notNullable().defaultTo(0)
      table.check('discount_percent >= 0 AND discount_percent <= 100')
      table
        .integer('vat_code_id')
        .notNullable()
        .references('id')
        .inTable('vat_codes')
        .onDelete('RESTRICT')
        .index()
      // Copied from the VAT Code when the line is written (ADR 0008)
      table.decimal('vat_rate', 5, 2).notNullable()
      table.string('natura', 4).nullable()
      table.check('(vat_rate = 0) = (natura IS NOT NULL)')
      table.decimal('line_total', 14, 2).notNullable()
      // Same rounding as invoiceLineTotal: half away from zero, to the cent
      table.check('line_total = round(quantity * unit_price * (100 - discount_percent) / 100, 2)')
      table.index(['invoice_id', 'position'])
    })
  }

  async down() {
    this.schema.dropTable('invoice_lines')
    this.schema.dropTable('invoices')
  }
}
