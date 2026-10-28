import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('payment_terms', (table) => {
      // FatturaPA ModalitaPagamento; bank transfer unless the Admin says otherwise
      table.string('payment_method', 4).notNullable().defaultTo('MP05')
    })
    this.schema.raw(
      "ALTER TABLE payment_terms ADD CONSTRAINT payment_terms_payment_method_check CHECK (payment_method IN ('MP01', 'MP02', 'MP05', 'MP08', 'MP12', 'MP19'))"
    )

    // One numbering sequence per year; the Admin may set where it starts
    // until the year's first invoice is finalised
    this.schema.createTable('invoice_sequences', (table) => {
      table.increments('id').notNullable()
      table.integer('year').notNullable().unique()
      table.integer('next_number').notNullable().defaultTo(1)
      table.check('next_number >= 1')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_status_check')
    this.schema.raw(
      "ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'finalised'))"
    )
    this.schema.alterTable('invoices', (table) => {
      table.integer('year').nullable()
      table.integer('number').nullable()
      table.date('issued_on').nullable()
      table.date('due_on').nullable()
      table.string('payment_method', 4).nullable()
      // The Customer and the company as they were when finalised: the
      // invoice is a fiscal document and never changes with later edits
      table.jsonb('customer_snapshot').nullable()
      table.jsonb('company_snapshot').nullable()
      table.timestamp('finalised_at').nullable()
      table.unique(['year', 'number'])
    })

    // A draft has none of the finalised fields; anything else has all of them
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_finalised_fields_check CHECK (
      (status = 'draft' AND number IS NULL AND year IS NULL AND issued_on IS NULL AND due_on IS NULL
        AND payment_method IS NULL AND customer_snapshot IS NULL AND company_snapshot IS NULL
        AND finalised_at IS NULL)
      OR (status <> 'draft' AND number IS NOT NULL AND year IS NOT NULL AND issued_on IS NOT NULL
        AND due_on IS NOT NULL AND payment_method IS NOT NULL AND customer_snapshot IS NOT NULL
        AND company_snapshot IS NOT NULL AND finalised_at IS NOT NULL)
    )`)
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_finalised_values_check CHECK (
      status = 'draft' OR (number >= 1 AND year = extract(year FROM issued_on)
        AND payment_method IN ('MP01', 'MP02', 'MP05', 'MP08', 'MP12', 'MP19')
        AND jsonb_typeof(customer_snapshot) = 'object'
        AND jsonb_typeof(company_snapshot) = 'object'))`)

    this.schema.alterTable('invoice_lines', (table) => {
      // Copied from the VAT Code with its rate and Natura (ADR 0008)
      table.text('legal_note').nullable()
    })
  }

  async down() {
    this.schema.alterTable('invoice_lines', (table) => {
      table.dropColumn('legal_note')
    })
    // Finalised Invoices can't exist without these columns: delete them,
    // with the direct-sale Stock Movements they created (referenced by the
    // number as formatInvoiceNumber writes it, "N/YYYY")
    this.defer(async (db) => {
      await db.rawQuery(`DELETE FROM stock_movements WHERE kind = 'sale' AND reference IN (
        SELECT number || '/' || year FROM invoices WHERE status <> 'draft')`)
      await db.rawQuery("DELETE FROM invoices WHERE status <> 'draft'")
    })
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_finalised_values_check')
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_finalised_fields_check')
    this.schema.alterTable('invoices', (table) => {
      table.dropUnique(['year', 'number'])
      table.dropColumns(
        'year',
        'number',
        'issued_on',
        'due_on',
        'payment_method',
        'customer_snapshot',
        'company_snapshot',
        'finalised_at'
      )
    })
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_status_check')
    this.schema.raw(
      "ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft'))"
    )
    this.schema.dropTable('invoice_sequences')
    this.schema.alterTable('payment_terms', (table) => {
      table.dropColumn('payment_method')
    })
  }
}
