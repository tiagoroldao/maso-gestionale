import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      // Shown as "2026/0007": a yearly sequence for quoting a Job on the phone
      table.integer('year').notNullable()
      table.integer('sequence').notNullable()
      table.unique(['year', 'sequence'])

      table
        .integer('customer_id')
        .notNullable()
        .references('id')
        .inTable('customers')
        .onDelete('RESTRICT')
      table.integer('site_id').nullable().references('id').inTable('sites').onDelete('RESTRICT')

      table.enum('kind', ['quoted', 'time_and_materials']).notNullable()
      // Stored statuses only; Work Complete, Invoiced and Closed are derived later
      table
        .enum('status', ['open', 'quoted', 'accepted', 'in_progress', 'cancelled'])
        .notNullable()
        .defaultTo('open')

      table.string('title', 255).notNullable()
      table.text('description').nullable()
      table.timestamp('cancelled_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['customer_id'])
      table.index(['site_id'])
      table.index(['status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
