import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'customers'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.enum('type', ['private', 'company', 'condominium']).notNullable()

      // Private individuals have first and last name; others a single name
      table.string('first_name').nullable()
      table.string('last_name').nullable()
      table.string('name').nullable()

      table.string('vat_number', 11).nullable()
      table.string('tax_code', 16).nullable()
      table.string('sdi_code', 7).notNullable().defaultTo('0000000')
      table.string('pec', 254).nullable()

      table.string('street').notNullable()
      table.string('street_number', 8).nullable()
      table.string('postal_code', 5).notNullable()
      table.string('city').notNullable()
      table.string('province', 2).notNullable()

      table.string('email', 254).nullable()
      table.string('phone', 32).nullable()
      table.text('notes').nullable()

      table
        .integer('payment_terms_id')
        .notNullable()
        .references('id')
        .inTable('payment_terms')
        .onDelete('RESTRICT')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['tax_code'])
      table.index(['vat_number'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
