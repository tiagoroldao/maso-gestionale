import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('categories', (table) => {
      table.increments('id').notNullable()
      table.string('name', 100).notNullable().unique()
      // Only used to suggest a resale price (ADR 0007: decimals as numeric)
      table.decimal('markup_percent', 6, 2).notNullable().defaultTo(0)
      table.check('markup_percent >= 0')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('items', (table) => {
      table.increments('id').notNullable()
      table.string('code', 50).notNullable().unique()
      // FatturaPA Descrizione allows 1000 characters
      table.string('description', 1000).notNullable()
      // FatturaPA UnitaMisura allows 10 characters
      table.string('unit', 10).notNullable().defaultTo('pz')
      table
        .integer('category_id')
        .nullable()
        .references('id')
        .inTable('categories')
        .onDelete('RESTRICT')
      table.string('supplier_name', 255).nullable()
      table.string('supplier_code', 100).nullable()
      table.decimal('vat_rate', 5, 2).notNullable().defaultTo(22)
      table.decimal('purchase_price', 14, 4).notNullable().defaultTo(0)
      table.decimal('resale_price', 14, 4).notNullable().defaultTo(0)
      table.check('purchase_price >= 0')
      table.check('resale_price >= 0')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['category_id'])
    })
  }

  async down() {
    this.schema.dropTable('items')
    this.schema.dropTable('categories')
  }
}
