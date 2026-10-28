import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // The Superuser's settings for this Instance (ADR 0005); one row
    this.schema.createTable('instance_settings', (table) => {
      table.integer('id').primary().notNullable()
      table.string('sdi_mode', 20).notNullable().defaultTo('manual')
      // Encrypted with APP_KEY, never sent back to the page
      table.text('invoicetronic_api_key').nullable()
      table.integer('polling_minutes').notNullable().defaultTo(60)
      table.boolean('webhook_enabled').notNullable().defaultTo(false)
      table.text('webhook_secret').nullable()
      table.string('public_url', 255).nullable()
      table.timestamp('updated_at').nullable()
    })
    this.schema.raw(`ALTER TABLE instance_settings ADD CONSTRAINT instance_settings_values_check
      CHECK (id = 1 AND sdi_mode IN ('manual', 'invoicetronic') AND polling_minutes BETWEEN 5 AND 1440)`)
  }

  async down() {
    this.schema.dropTable('instance_settings')
  }
}
