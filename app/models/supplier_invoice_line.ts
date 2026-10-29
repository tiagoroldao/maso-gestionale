import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { SupplierInvoiceLineSchema } from '#database/schema'
import SupplierInvoice from '#models/supplier_invoice'

/**
 * One line of a Supplier Invoice, as the supplier wrote it (DettaglioLinee).
 */
export default class SupplierInvoiceLine extends SupplierInvoiceLineSchema {
  static table = 'supplier_invoice_lines'

  @belongsTo(() => SupplierInvoice)
  declare supplierInvoice: BelongsTo<typeof SupplierInvoice>
}
