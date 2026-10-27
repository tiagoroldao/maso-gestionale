import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('visit_hours', (table) => {
      table.increments('id').notNullable()
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT')
      table
        .integer('labour_rate_id')
        .notNullable()
        .references('id')
        .inTable('labour_rates')
        .onDelete('RESTRICT')
      table.decimal('hours', 7, 3).notNullable()
      // The rate's price when recorded, so later rate changes don't reprice
      // work already done; never sent to Technicians
      table.decimal('unit_price', 14, 4).notNullable()
      table.check('hours > 0')
      table.timestamp('created_at').notNullable()
      table.index(['visit_id'])
    })

    this.schema.createTable('visit_items', (table) => {
      table.increments('id').notNullable()
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT')
      table.decimal('quantity', 14, 3).notNullable()
      table.check('quantity > 0')
      // The Item's resale price when recorded (see visit_hours.unit_price)
      table.decimal('unit_price', 14, 4).notNullable()
      table.boolean('installed').notNullable().defaultTo(false)
      table
        .integer('installed_equipment_id')
        .nullable()
        .references('id')
        .inTable('installed_equipment')
        .onDelete('SET NULL')
      // Set when the Visit is done and the Items are taken off stock
      table
        .integer('stock_movement_id')
        .nullable()
        .unique()
        .references('id')
        .inTable('stock_movements')
        .onDelete('RESTRICT')
      table.timestamp('created_at').notNullable()
      table.index(['visit_id'])
    })
  }

  async down() {
    this.schema.dropTable('visit_items')
    this.schema.dropTable('visit_hours')
  }
}
