import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A Charge imported from a Quote line (#117, ADR 0012) names that line,
 * so the Quote can show which of its lines were imported, and how often.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('charges', (table) => {
      table
        .integer('quote_line_id')
        .nullable()
        .references('id')
        .inTable('quote_lines')
        .onDelete('SET NULL')
      table.index(['quote_line_id'])
    })
  }

  async down() {
    this.schema.alterTable('charges', (table) => {
      table.dropColumn('quote_line_id')
    })
  }
}
