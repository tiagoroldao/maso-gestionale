import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { SupplierInvoiceSchema } from '#database/schema'
import Supplier from '#models/supplier'
import SupplierInvoiceLine from '#models/supplier_invoice_line'
import type {
  SupplierInvoiceDetails,
  SupplierInvoiceSource,
  SupplierInvoiceStatus,
} from '#shared/supplier_invoices'

/**
 * An electronic invoice received from a Supplier (#198): its header and
 * lines read from the FatturaPA file, the rest of the document in
 * `details`, and the original file in the Instance's storage at
 * `filePath`. Office marks it handled once dealt with.
 */
export default class SupplierInvoice extends SupplierInvoiceSchema {
  static table = 'supplier_invoices'

  declare status: SupplierInvoiceStatus
  declare receivedVia: SupplierInvoiceSource
  declare details: SupplierInvoiceDetails

  @belongsTo(() => Supplier)
  declare supplier: BelongsTo<typeof Supplier>

  @hasMany(() => SupplierInvoiceLine)
  declare lines: HasMany<typeof SupplierInvoiceLine>
}
