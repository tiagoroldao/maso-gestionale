import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * FatturaPA's Natura codes as of this migration (`NATURA_CODES` in
 * shared/vat.ts), written out so a later change to that list never
 * changes what this migration did.
 */
const NATURA_CODES = [
  'N1',
  'N2.1',
  'N2.2',
  'N3.1',
  'N3.2',
  'N3.3',
  'N3.4',
  'N3.5',
  'N3.6',
  'N4',
  'N5',
  'N6.1',
  'N6.2',
  'N6.3',
  'N6.4',
  'N6.5',
  'N6.6',
  'N6.7',
  'N6.8',
  'N6.9',
  'N7',
]

/**
 * Every table that holds a Natura (VAT Codes and the lines and rows that
 * snapshot one) accepts only the FatturaPA codes, so nothing else can reach
 * an XML file (#65).
 */
const NATURA_TABLES = ['vat_codes', 'invoice_lines', 'quote_lines', 'legacy_vat_rows']

const quoteLinesVatCheck = (textLine: string) =>
  `ALTER TABLE quote_lines ADD CONSTRAINT quote_lines_vat_check CHECK (
    (${textLine})
    OR (kind <> 'text' AND vat_code_id IS NOT NULL AND vat_rate IS NOT NULL
      AND (vat_rate = 0) = (natura IS NOT NULL)))`

const TEXT_LINE = "kind = 'text' AND vat_code_id IS NULL AND vat_rate IS NULL AND natura IS NULL"

export default class extends BaseSchema {
  async up() {
    const codes = NATURA_CODES.map((code) => `'${code}'`).join(', ')
    for (const table of NATURA_TABLES) {
      this.schema.raw(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_natura_check
         CHECK (natura IS NULL OR natura IN (${codes}))`
      )
    }
    // A Quote's text line has no VAT treatment, so no legal note either
    this.schema.raw("UPDATE quote_lines SET legal_note = NULL WHERE kind = 'text'")
    this.schema.raw('ALTER TABLE quote_lines DROP CONSTRAINT quote_lines_vat_check')
    this.schema.raw(quoteLinesVatCheck(`${TEXT_LINE} AND legal_note IS NULL`))
  }

  async down() {
    this.schema.raw('ALTER TABLE quote_lines DROP CONSTRAINT quote_lines_vat_check')
    this.schema.raw(quoteLinesVatCheck(TEXT_LINE))
    for (const table of NATURA_TABLES) {
      this.schema.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_natura_check`)
    }
  }
}
