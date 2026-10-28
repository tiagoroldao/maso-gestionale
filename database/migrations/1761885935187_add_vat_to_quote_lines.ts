import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('quote_lines', (table) => {
      table
        .integer('vat_code_id')
        .nullable()
        .references('id')
        .inTable('vat_codes')
        .onDelete('RESTRICT')
        .index()
      // Copied from the VAT Code when the line is written (ADR 0008)
      table.decimal('vat_rate', 5, 2).nullable()
      table.string('natura', 4).nullable()
      table.text('legal_note').nullable()
    })

    this.defer(async (db) => {
      // Existing priced lines: an Item's own default code, otherwise the
      // standard rate (the highest active rate that charges VAT)
      await db.rawQuery(`
        UPDATE quote_lines SET vat_code_id = items.vat_code_id
        FROM items WHERE quote_lines.item_id = items.id`)
      await db.rawQuery(`
        UPDATE quote_lines SET vat_code_id = (
          SELECT id FROM vat_codes WHERE natura IS NULL AND archived_at IS NULL
          ORDER BY rate DESC, id LIMIT 1)
        WHERE kind <> 'text' AND vat_code_id IS NULL`)
      await db.rawQuery(`
        UPDATE quote_lines SET vat_rate = vat_codes.rate, natura = vat_codes.natura,
          legal_note = vat_codes.legal_note
        FROM vat_codes WHERE quote_lines.vat_code_id = vat_codes.id`)
      // Priced lines carry a VAT treatment; text lines none
      await db.rawQuery(`ALTER TABLE quote_lines ADD CONSTRAINT quote_lines_vat_check CHECK (
        (kind = 'text' AND vat_code_id IS NULL AND vat_rate IS NULL AND natura IS NULL)
        OR (kind <> 'text' AND vat_code_id IS NOT NULL AND vat_rate IS NOT NULL
          AND (vat_rate = 0) = (natura IS NOT NULL)))`)
    })
  }

  async down() {
    this.schema.raw('ALTER TABLE quote_lines DROP CONSTRAINT quote_lines_vat_check')
    this.schema.alterTable('quote_lines', (table) => {
      table.dropColumns('vat_code_id', 'vat_rate', 'natura', 'legal_note')
    })
  }
}
