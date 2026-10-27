import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('item_documents', (table) => {
      table.increments('id').notNullable()
      table.integer('item_id').notNullable().references('id').inTable('items').onDelete('CASCADE')
      table.string('title', 255).notNullable()
      // Relative to STORAGE_PATH, so it is part of the backed-up volume
      table.string('file_path', 512).notNullable()
      table.string('original_name', 255).notNullable()
      table.string('mime_type', 100).notNullable()
      table.integer('size_bytes').notNullable()
      table.timestamp('created_at').notNullable()
      table.index(['item_id'])
    })

    this.schema.alterTable('items', (table) => {
      table.integer('maintenance_interval_months').nullable()
      table.check('maintenance_interval_months > 0', [], 'items_maintenance_interval_check')
    })

    this.schema.alterTable('installed_equipment', (table) => {
      table.integer('item_id').nullable().references('id').inTable('items').onDelete('RESTRICT')
      table.index(['item_id'])
    })
  }

  async down() {
    this.schema.alterTable('installed_equipment', (table) => {
      table.dropColumn('item_id')
    })
    this.schema.alterTable('items', (table) => {
      table.dropChecks(['items_maintenance_interval_check'])
      table.dropColumn('maintenance_interval_months')
    })
    this.schema.dropTable('item_documents')
  }
}
