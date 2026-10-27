import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Company settings edited live by the Admin (ADR 0005). Exactly one row,
 * with id 1; fields stay empty until the Admin fills them in.
 */
export default class extends BaseSchema {
  protected tableName = 'company_settings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.integer('id').primary()
      table.check('id = 1')

      table.string('name').nullable()
      table.string('vat_number', 11).nullable()
      table.string('tax_code', 16).nullable()
      table.string('tax_regime', 4).nullable()

      table.string('street').nullable()
      table.string('street_number', 8).nullable()
      table.string('postal_code', 5).nullable()
      table.string('city').nullable()
      table.string('province', 2).nullable()

      table.string('iban', 27).nullable()
      table.string('email', 254).nullable()
      table.string('phone', 32).nullable()
      table.string('logo_file').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
