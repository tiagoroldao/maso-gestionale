import { BaseSchema } from '@adonisjs/lucid/schema'

const FINALISED_FIELDS_BEFORE = `(status = 'draft' AND number IS NULL AND year IS NULL AND issued_on IS NULL AND due_on IS NULL
    AND payment_method IS NULL AND customer_snapshot IS NULL AND company_snapshot IS NULL
    AND finalised_at IS NULL)
  OR (status <> 'draft' AND number IS NOT NULL AND year IS NOT NULL AND issued_on IS NOT NULL
    AND due_on IS NOT NULL AND payment_method IS NOT NULL AND customer_snapshot IS NOT NULL
    AND company_snapshot IS NOT NULL AND finalised_at IS NOT NULL)`

/**
 * Credit Notes (#145, ADR 0014): an Invoice record of type "credit_note"
 * crediting one issued Invoice, its lines each crediting one of that
 * Invoice's lines by amount. Credit Notes are numbered in the Invoice
 * sequence or in their own series, as the Admin chooses per year.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('invoices', (table) => {
      // FatturaPA TD01/TD02 (an invoice, `advance` telling which) or TD04
      table.string('document_type', 20).notNullable().defaultTo('invoice')
      // The Invoice a Credit Note credits
      table
        .integer('credits_invoice_id')
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('RESTRICT')
        .index()
      // The numbering series the number was taken from, once finalised
      table.string('series', 20).nullable()
    })
    this.schema.raw(`UPDATE invoices SET series = 'invoice' WHERE status <> 'draft'`)
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_document_type_check
      CHECK (document_type IN ('invoice', 'credit_note'))`)
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_series_check
      CHECK (series IN ('invoice', 'credit_note')
        AND (series = 'invoice' OR document_type = 'credit_note'))`)
    // A Credit Note credits one Invoice, and is neither an advance nor a
    // Job's own Invoice (it follows the Invoice it credits)
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_credit_note_check CHECK (
      (document_type = 'credit_note') = (credits_invoice_id IS NOT NULL)
      AND (document_type = 'invoice' OR (NOT advance AND job_id IS NULL))
      AND (credits_invoice_id IS NULL OR credits_invoice_id <> id))`)
    // A Credit Note has no due date or payment method: nothing is paid on it
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_finalised_fields_check')
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_finalised_fields_check CHECK (
      (status = 'draft' AND number IS NULL AND year IS NULL AND series IS NULL AND issued_on IS NULL
        AND due_on IS NULL AND payment_method IS NULL AND customer_snapshot IS NULL
        AND company_snapshot IS NULL AND finalised_at IS NULL)
      OR (status <> 'draft' AND number IS NOT NULL AND year IS NOT NULL AND series IS NOT NULL
        AND issued_on IS NOT NULL AND customer_snapshot IS NOT NULL
        AND company_snapshot IS NOT NULL AND finalised_at IS NOT NULL
        AND (document_type = 'credit_note' OR (due_on IS NOT NULL AND payment_method IS NOT NULL))
        AND (document_type = 'invoice' OR (due_on IS NULL AND payment_method IS NULL)))
    )`)
    // Numbers are unique within their series
    this.schema.alterTable('invoices', (table) => {
      table.dropUnique(['year', 'number'])
      table.unique(['series', 'year', 'number'])
    })

    this.schema.alterTable('invoice_lines', (table) => {
      // The credited Invoice's line this Credit Note line credits, by amount
      table
        .integer('credits_line_id')
        .nullable()
        .references('id')
        .inTable('invoice_lines')
        .onDelete('RESTRICT')
        .index()
    })

    // One sequence per series and year
    this.schema.alterTable('invoice_sequences', (table) => {
      table.string('series', 20).notNullable().defaultTo('invoice')
      table.check(`series IN ('invoice', 'credit_note')`, [], 'invoice_sequences_series_check')
      table.dropUnique(['year'])
      table.unique(['series', 'year'])
    })

    // How Credit Notes are numbered from `year` on, until a later row: in
    // the Invoice sequence ("shared") or their own series ("own"); shared
    // before the first row
    this.schema.createTable('credit_note_numbering', (table) => {
      table.increments('id').notNullable()
      table.integer('year').notNullable().unique()
      table.string('mode', 10).notNullable()
      table.check(`mode IN ('shared', 'own')`, [], 'credit_note_numbering_mode_check')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('credit_note_numbering')

    // Credit Notes can't exist without these columns: they go, with their
    // Submissions (their lines cascade)
    this.schema.raw(`DELETE FROM invoice_submissions WHERE invoice_id IN (
      SELECT id FROM invoices WHERE document_type = 'credit_note')`)
    this.schema.raw(`DELETE FROM invoices WHERE document_type = 'credit_note'`)

    this.schema.raw(`DELETE FROM invoice_sequences WHERE series <> 'invoice'`)
    this.schema.alterTable('invoice_sequences', (table) => {
      table.dropUnique(['series', 'year'])
      table.unique(['year'])
      table.dropChecks(['invoice_sequences_series_check'])
      table.dropColumn('series')
    })

    this.schema.alterTable('invoice_lines', (table) => {
      table.dropColumn('credits_line_id')
    })

    this.schema.alterTable('invoices', (table) => {
      table.dropUnique(['series', 'year', 'number'])
      table.unique(['year', 'number'])
    })
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_finalised_fields_check')
    this.schema.raw(
      `ALTER TABLE invoices ADD CONSTRAINT invoices_finalised_fields_check CHECK (${FINALISED_FIELDS_BEFORE})`
    )
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_credit_note_check')
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_series_check')
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_document_type_check')
    this.schema.alterTable('invoices', (table) => {
      table.dropColumns('document_type', 'credits_invoice_id', 'series')
    })
  }
}
