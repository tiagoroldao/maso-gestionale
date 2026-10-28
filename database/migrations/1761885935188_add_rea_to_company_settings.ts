import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Registro Imprese details (FatturaPA IscrizioneREA), required on invoices
 * of businesses registered there.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('company_settings', (table) => {
      table.string('rea_office', 2).nullable()
      table.string('rea_number', 20).nullable()
      table.decimal('share_capital', 15, 2).nullable()
      // SU: sole shareholder, SM: several
      table.string('sole_shareholder', 2).nullable()
      // LN: not in liquidation, LS: in liquidation
      table.string('liquidation_status', 2).notNullable().defaultTo('LN')
    })
    this.schema.raw(`ALTER TABLE company_settings ADD CONSTRAINT company_settings_rea_check CHECK (
      (rea_office IS NULL) = (rea_number IS NULL)
      AND (sole_shareholder IS NULL OR sole_shareholder IN ('SU', 'SM'))
      AND liquidation_status IN ('LN', 'LS')
      AND (share_capital IS NULL OR share_capital >= 0))`)
  }

  async down() {
    this.schema.raw('ALTER TABLE company_settings DROP CONSTRAINT company_settings_rea_check')
    this.schema.alterTable('company_settings', (table) => {
      table.dropColumns(
        'rea_office',
        'rea_number',
        'share_capital',
        'sole_shareholder',
        'liquidation_status'
      )
    })
  }
}
