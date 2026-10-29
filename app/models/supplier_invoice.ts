import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { SupplierInvoiceSchema } from '#database/schema'
import Supplier from '#models/supplier'
import SupplierInvoiceLine from '#models/supplier_invoice_line'
import type {
  LegalArchivingState,
  SupplierInvoiceDetails,
  SupplierInvoiceSource,
  SupplierInvoiceStatus,
} from '#shared/supplier_invoices'

/**
 * An electronic invoice received from a Supplier (#198): its header and
 * lines read from the FatturaPA file, the rest of the document in
 * `details`, and the original file in the Instance's storage at
 * `filePath`. It is handled once Office has received each of its lines
 * into stock, marked it already received (#210) or marked it not stock
 * (#199, SupplierInvoiceLines). `spreadDiscounts` says whether the
 * discounts on the whole invoice lower its lines' default costs (#210).
 * `legalArchiving` follows its file's legal archiving through the SDI
 * intermediary (#214, SupplierInvoiceArchiving), with the intermediary's
 * ids once requested.
 */
export default class SupplierInvoice extends SupplierInvoiceSchema {
  static table = 'supplier_invoices'

  declare status: SupplierInvoiceStatus
  declare receivedVia: SupplierInvoiceSource
  declare details: SupplierInvoiceDetails
  declare legalArchiving: LegalArchivingState | null

  // A JSON array: stringified, as the driver would write it as a Postgres array
  @column({ prepare: (value: string[] | null) => (value === null ? null : JSON.stringify(value)) })
  declare legalArchivingIds: string[] | null

  @belongsTo(() => Supplier)
  declare supplier: BelongsTo<typeof Supplier>

  @hasMany(() => SupplierInvoiceLine)
  declare lines: HasMany<typeof SupplierInvoiceLine>
}
