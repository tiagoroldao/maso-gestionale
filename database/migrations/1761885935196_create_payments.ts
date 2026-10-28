import { BaseSchema } from '@adonisjs/lucid/schema'
import { invoiceTotals } from '#shared/invoice_totals'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('invoices', (table) => {
      // The total due, fixed once finalised (and after a corrected
      // Rejection), so lists can filter by payment in SQL
      table.decimal('total', 14, 2).nullable()
    })

    this.schema.createTable('payments', (table) => {
      table.increments('id').notNullable()
      table
        .integer('invoice_id')
        .notNullable()
        .references('id')
        .inTable('invoices')
        .onDelete('RESTRICT')
        .index()
      table.decimal('amount', 14, 2).notNullable()
      table.check('amount > 0')
      table.date('paid_on').notNullable()
      table.string('note', 255).nullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    // Invoices finalised before this get their total from their lines
    this.defer(async (db) => {
      const invoices = await db.from('invoices').whereNot('status', 'draft')
      for (const invoice of invoices) {
        const lines = await db.from('invoice_lines').where('invoice_id', invoice.id)
        const totals = invoiceTotals(
          lines.map((line) => ({
            quantity: line.quantity,
            unitPrice: line.unit_price,
            discountPercent: line.discount_percent,
            vatRate: line.vat_rate,
            natura: line.natura,
          })),
          invoice.discount_percent
        )
        await db.from('invoices').where('id', invoice.id).update({ total: totals.total })
      }
    })
    // Only once the backfill gave issued Invoices their total
    this.schema.raw(
      "ALTER TABLE invoices ADD CONSTRAINT invoices_total_check CHECK ((status = 'draft') = (total IS NULL))"
    )
  }

  async down() {
    this.schema.dropTable('payments')
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_total_check')
    this.schema.alterTable('invoices', (table) => {
      table.dropColumn('total')
    })
  }
}
