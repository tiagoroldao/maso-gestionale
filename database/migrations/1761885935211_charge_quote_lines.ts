import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A Charge imported from a Quote line (#117, ADR 0012) names that line,
 * so the Quote can show which of its lines were imported, and how often.
 * It keeps the VAT Code the Customer accepted on the line, which billing
 * uses instead of the Job's default rules, and the line's description,
 * as long as an Invoice line's.
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
      table
        .integer('vat_code_id')
        .nullable()
        .references('id')
        .inTable('vat_codes')
        .onDelete('RESTRICT')
      table.string('description', 1000).notNullable().alter()
      table.index(['quote_line_id'])
    })
  }

  async down() {
    // Longer descriptions are cut to fit back
    this.schema.raw('UPDATE charges SET description = left(description, 255)')
    this.schema.alterTable('charges', (table) => {
      table.string('description', 255).notNullable().alter()
      table.dropColumn('vat_code_id')
      table.dropColumn('quote_line_id')
    })
  }
}
