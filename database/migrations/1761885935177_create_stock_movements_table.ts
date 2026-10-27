import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('stock_movements', (table) => {
      table.increments('id').notNullable()
      table.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT')
      table.enum('kind', ['receipt', 'usage', 'sale', 'adjustment']).notNullable()
      // Signed: receipts add, usage and sales remove, adjustments either way.
      // Decimal because pipe and cable are counted in metres (ADR 0007).
      table.decimal('quantity', 14, 3).notNullable()
      table.check('quantity <> 0')
      table.decimal('unit_cost', 14, 4).nullable()
      table.date('occurred_on').notNullable()
      table.string('reference', 255).nullable()
      table.text('reason').nullable()
      table.check(`kind <> 'adjustment' OR reason IS NOT NULL`)
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('created_at').notNullable()

      table.index(['item_id', 'occurred_on'])
    })

    this.schema.alterTable('items', (table) => {
      table.decimal('reorder_level', 14, 3).nullable()
    })
  }

  async down() {
    this.schema.alterTable('items', (table) => {
      table.dropColumn('reorder_level')
    })
    this.schema.dropTable('stock_movements')
  }
}
