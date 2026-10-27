import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('sites', (table) => {
      table.increments('id').notNullable()
      table.string('label').nullable()

      table.string('street').notNullable()
      table.string('street_number', 8).nullable()
      table.string('unit', 64).nullable()
      table.string('postal_code', 5).notNullable()
      table.string('city').notNullable()
      table.string('province', 2).notNullable()
      table.text('access_notes').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('customer_site', (table) => {
      table
        .integer('customer_id')
        .notNullable()
        .references('id')
        .inTable('customers')
        .onDelete('CASCADE')
      table.integer('site_id').notNullable().references('id').inTable('sites').onDelete('CASCADE')
      table.primary(['customer_id', 'site_id'])
      table.index(['site_id'])
      table.timestamp('created_at').notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable('customer_site')
    this.schema.dropTable('sites')
  }
}
