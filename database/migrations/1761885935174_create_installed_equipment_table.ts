import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'installed_equipment'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      // Equipment belongs to the place, not to whoever the Customer is
      table.integer('site_id').notNullable().references('id').inTable('sites').onDelete('RESTRICT')

      table.string('equipment_type', 100).notNullable()
      table.string('make', 100).nullable()
      table.string('model', 100).nullable()
      table.string('serial_number', 100).nullable()
      table.date('installed_on').nullable()

      table.integer('maintenance_interval_months').nullable()
      table.check('maintenance_interval_months > 0')
      table.date('last_serviced_on').nullable()
      table.text('notes').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['site_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
