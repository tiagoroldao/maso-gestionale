import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('visit_notes', (table) => {
      table.increments('id').notNullable()
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.text('body').notNullable()
      table.check(`btrim(body) <> ''`)
      table.timestamp('created_at').notNullable()
      table.index(['visit_id'])
    })

    this.schema.createTable('visit_photos', (table) => {
      table.increments('id').notNullable()
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      // Relative to STORAGE_PATH, in the backed-up volume
      table.string('file_path', 512).notNullable()
      table.string('mime_type', 100).notNullable()
      table.integer('size_bytes').notNullable()
      table.timestamp('created_at').notNullable()
      table.index(['visit_id'])
    })
  }

  async down() {
    this.schema.dropTable('visit_photos')
    this.schema.dropTable('visit_notes')
  }
}
