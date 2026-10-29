import { BaseSchema } from '@adonisjs/lucid/schema'

const CREDIT_NOTE_CHECK_BEFORE = `(document_type = 'credit_note') = (credits_invoice_id IS NOT NULL)
  AND (document_type = 'invoice' OR (NOT advance AND job_id IS NULL))
  AND (credits_invoice_id IS NULL OR credits_invoice_id <> id)`

const FINALISED_FIELDS_BEFORE = `(status = 'draft' AND number IS NULL AND year IS NULL AND series IS NULL
    AND issued_on IS NULL AND due_on IS NULL AND payment_method IS NULL
    AND customer_snapshot IS NULL AND company_snapshot IS NULL AND finalised_at IS NULL)
  OR (status <> 'draft' AND number IS NOT NULL AND year IS NOT NULL AND series IS NOT NULL
    AND issued_on IS NOT NULL AND customer_snapshot IS NOT NULL
    AND company_snapshot IS NOT NULL AND finalised_at IS NOT NULL
    AND (document_type = 'credit_note' OR (due_on IS NOT NULL AND payment_method IS NOT NULL))
    AND (document_type = 'invoice' OR (due_on IS NULL AND payment_method IS NULL)))`

const FINALISED_VALUES_BEFORE = `status = 'draft' OR (number >= 1 AND year = extract(year FROM issued_on)
    AND payment_method IN ('MP01', 'MP02', 'MP05', 'MP08', 'MP12', 'MP19')
    AND jsonb_typeof(customer_snapshot) = 'object'
    AND jsonb_typeof(company_snapshot) = 'object')`

const replace = (name: string, check: string) => [
  `ALTER TABLE invoices DROP CONSTRAINT ${name}`,
  `ALTER TABLE invoices ADD CONSTRAINT ${name} CHECK (${check})`,
]

/**
 * Legacy Invoices (#27): invoices the previous accounting software issued,
 * entered by hand as an Invoice record of type "legacy". No lines and no
 * SDI flow: the old number as text, the date and due date, the three
 * totals and the original PDF. Stored as delivered (issued, outside the
 * app), so Payments, payment status and the Job's indicators treat it as
 * any issued Invoice. An advance gives its VAT rows (VAT Code and taxable
 * each), from which later Invoices build their deduction lines (ADR 0011).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('invoices', (table) => {
      // The number the old software gave it, as printed; at most 20
      // characters, as a Credit Note refers to it (FatturaPA IdDocumento)
      table.string('legacy_number', 20).nullable()
      // Its taxable amount and VAT, as printed; the grand total is `total`
      table.decimal('taxable', 14, 2).nullable()
      table.decimal('vat', 14, 2).nullable()
      // The original PDF, in the Instance's storage
      table.string('pdf_path', 255).nullable()
      table.string('pdf_name', 255).nullable()
    })
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_document_type_check')
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_document_type_check
      CHECK (document_type IN ('invoice', 'credit_note', 'legacy'))`)
    // An advance (of a Job) may be a Legacy Invoice; a Credit Note still
    // follows the Invoice it credits
    for (const sql of replace(
      'invoices_credit_note_check',
      `(document_type = 'credit_note') = (credits_invoice_id IS NOT NULL)
        AND (document_type <> 'credit_note' OR (NOT advance AND job_id IS NULL))
        AND (credits_invoice_id IS NULL OR credits_invoice_id <> id)`
    )) {
      this.schema.raw(sql)
    }
    // A Legacy Invoice was numbered and issued by the old software: none
    // of the fields finalising sets, but its own number, dates and totals
    for (const sql of replace(
      'invoices_finalised_fields_check',
      `document_type = 'legacy' OR ${FINALISED_FIELDS_BEFORE}`
    )) {
      this.schema.raw(sql)
    }
    for (const sql of replace(
      'invoices_finalised_values_check',
      `document_type = 'legacy' OR ${FINALISED_VALUES_BEFORE}`
    )) {
      this.schema.raw(sql)
    }
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_legacy_check CHECK (
      (document_type = 'legacy') = (legacy_number IS NOT NULL)
      AND (document_type = 'legacy') = (taxable IS NOT NULL)
      AND (document_type = 'legacy') = (vat IS NOT NULL)
      AND (document_type = 'legacy') = (pdf_path IS NOT NULL)
      AND (pdf_path IS NULL) = (pdf_name IS NULL)
      AND (document_type <> 'legacy' OR (status = 'delivered' AND number IS NULL
        AND year IS NULL AND series IS NULL AND issued_on IS NOT NULL AND due_on IS NOT NULL
        AND total IS NOT NULL AND total > 0 AND taxable >= 0 AND vat >= 0
        AND discount_percent = 0 AND customer_snapshot IS NULL AND company_snapshot IS NULL
        AND finalised_at IS NULL)))`)
    // Two Legacy Invoices of a year never share a number
    this.schema.raw(`CREATE UNIQUE INDEX invoices_legacy_number_unique
      ON invoices (legacy_number, extract(year FROM issued_on))
      WHERE document_type = 'legacy'`)

    // A Legacy advance's VAT rows, as its PDF summarises them, with the
    // VAT Code's treatment copied (ADR 0008); VAT worked out per row
    this.schema.createTable('legacy_vat_rows', (table) => {
      table.increments('id').notNullable()
      table
        .integer('invoice_id')
        .notNullable()
        .references('id')
        .inTable('invoices')
        .onDelete('CASCADE')
        .index()
      table.integer('position').notNullable()
      table.integer('vat_code_id').notNullable().references('id').inTable('vat_codes')
      table.decimal('vat_rate', 5, 2).notNullable()
      table.string('natura', 4).nullable()
      table.text('legal_note').nullable()
      table.decimal('taxable', 14, 2).notNullable()
      table.decimal('vat', 14, 2).notNullable()
      table.timestamp('created_at').notNullable()
      table.check('taxable > 0 AND vat >= 0', [], 'legacy_vat_rows_amounts_check')
    })
  }

  async down() {
    // Legacy Invoices can't exist without these columns. One that an
    // Invoice takes back (an advance) can't go without rewriting that
    // Invoice: refuse; the others go with their Payments (their files stay
    // in storage)
    this.defer(async (db) => {
      const taken = await db
        .from('advance_deductions as ad')
        .join('invoices as a', 'a.id', 'ad.advance_id')
        .where('a.document_type', 'legacy')
        .first()
      if (taken) {
        throw new Error('An Invoice takes back a Legacy Invoice: remove the deduction first')
      }
      await db
        .from('payments')
        .whereIn('invoice_id', db.from('invoices').where('document_type', 'legacy').select('id'))
        .delete()
      await db.from('invoices').where('document_type', 'legacy').delete()
    })
    this.schema.dropTable('legacy_vat_rows')
    this.schema.raw('DROP INDEX invoices_legacy_number_unique')
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_legacy_check')
    for (const sql of [
      ...replace('invoices_finalised_values_check', FINALISED_VALUES_BEFORE),
      ...replace('invoices_finalised_fields_check', FINALISED_FIELDS_BEFORE),
      ...replace('invoices_credit_note_check', CREDIT_NOTE_CHECK_BEFORE),
    ]) {
      this.schema.raw(sql)
    }
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_document_type_check')
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_document_type_check
      CHECK (document_type IN ('invoice', 'credit_note'))`)
    this.schema.alterTable('invoices', (table) => {
      table.dropColumns('legacy_number', 'taxable', 'vat', 'pdf_path', 'pdf_name')
    })
  }
}
