import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Suppliers and Supplier Invoices (#198). A Supplier is known by its VAT
 * number (country and code): created by hand, or the first time one of its
 * invoices arrives. A Supplier Invoice is read from the FatturaPA file
 * Office uploads (XML or signed .p7m) or the SDI intermediary delivers
 * (#92): its header and lines become rows, the rest of what the page shows
 * (seller and buyer, VAT summary, payments, notes) is kept as read, and the
 * original file stays in the Instance's storage. One file may hold several
 * invoices: each is a row pointing at the same file.
 *
 * The same invoice never arrives twice: a supplier's number and date are
 * unique, and a file with an SDI identifier already received is refused
 * (SupplierInvoices.receive(), under a lock).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('suppliers', (table) => {
      table.increments('id').notNullable()
      table.string('name', 255).notNullable()
      // IdFiscaleIVA: country and code
      table.string('vat_country', 2).notNullable()
      table.string('vat_number', 28).notNullable()
      table.string('tax_code', 16).nullable()
      table.string('street', 255).nullable()
      table.string('postal_code', 10).nullable()
      table.string('city', 255).nullable()
      table.string('province', 2).nullable()
      table.string('country', 2).nullable()
      table.string('email', 255).nullable()
      table.string('phone', 50).nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.unique(['vat_country', 'vat_number'])
      table.check(
        `vat_country ~ '^[A-Z]{2}$' AND vat_number ~ '^[A-Z0-9]+$' AND btrim(name) <> ''`,
        [],
        'suppliers_identity_check'
      )
    })

    this.schema.createTable('supplier_invoices', (table) => {
      table.increments('id').notNullable()
      table.integer('supplier_id').notNullable().references('id').inTable('suppliers').index()
      // TipoDocumento (TD01 an invoice, TD04 a credit note…) and Divisa
      table.string('document_type', 4).notNullable()
      table.string('currency', 3).notNullable()
      table.string('number', 20).notNullable()
      table.date('issued_on').notNullable()
      table.decimal('taxable', 15, 2).notNullable()
      table.decimal('vat', 15, 2).notNullable()
      table.decimal('total', 15, 2).notNullable()
      // to_handle until Office has dealt with it (shared/supplier_invoices.ts)
      table.string('status', 20).notNullable().defaultTo('to_handle')
      table.timestamp('handled_at').nullable()
      table.integer('handled_by').nullable().references('id').inTable('users')
      // Uploaded by Office, or received through the intermediary (#92)
      table.string('received_via', 10).notNullable()
      table.integer('received_by').nullable().references('id').inTable('users')
      // SDI's identifier for the file (IdentificativoSdI), when known
      table.string('sdi_identifier', 64).nullable().index()
      // The original file in the Instance's storage, and its name
      table.string('file_path', 255).notNullable()
      table.string('file_name', 255).notNullable()
      // The rest of the document as read: seller, buyer, VAT summary, payments, notes
      table.jsonb('details').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.unique(['supplier_id', 'number', 'issued_on'])
      table.check(`status IN ('to_handle', 'handled')`, [], 'supplier_invoices_status_check')
      table.check(
        `(status = 'handled') = (handled_at IS NOT NULL) AND (handled_by IS NULL OR handled_at IS NOT NULL)`,
        [],
        'supplier_invoices_handled_check'
      )
      table.check(
        // An intermediary may not give SDI's identifier (#92)
        `received_via IN ('upload', 'sdi')`,
        [],
        'supplier_invoices_received_check'
      )
      table.check(`jsonb_typeof(details) = 'object'`, [], 'supplier_invoices_details_check')
    })

    this.schema.createTable('supplier_invoice_lines', (table) => {
      table.increments('id').notNullable()
      table
        .integer('supplier_invoice_id')
        .notNullable()
        .references('id')
        .inTable('supplier_invoices')
        .onDelete('CASCADE')
        .index()
      table.integer('position').notNullable()
      // NumeroLinea as the supplier numbered it
      table.integer('line_number').notNullable()
      // The supplier's article code (CodiceValore), as Items' supplier_code
      table.string('code', 35).nullable()
      table.text('description').notNullable()
      table.decimal('quantity', 21, 8).nullable()
      table.string('unit', 10).nullable()
      table.decimal('unit_price', 21, 8).notNullable()
      table.decimal('total', 21, 8).notNullable()
      table.decimal('vat_rate', 6, 2).notNullable()
      table.string('natura', 4).nullable()
      table.timestamp('created_at').notNullable()
      table.unique(['supplier_invoice_id', 'position'])
    })
  }

  async down() {
    // The files stay in storage
    this.schema.dropTable('supplier_invoice_lines')
    this.schema.dropTable('supplier_invoices')
    this.schema.dropTable('suppliers')
  }
}
