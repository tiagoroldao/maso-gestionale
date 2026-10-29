import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { SupplierInvoiceLineSchema } from '#database/schema'
import Item from '#models/item'
import StockMovement from '#models/stock_movement'
import SupplierInvoice from '#models/supplier_invoice'
import type { LineOutcome } from '#shared/supplier_invoices'

/**
 * One line of a Supplier Invoice, as the supplier wrote it (DettaglioLinee),
 * and what Office made of it (#199): received onto an Item, with its
 * receipt Stock Movement, or marked not stock; null while to handle.
 */
export default class SupplierInvoiceLine extends SupplierInvoiceLineSchema {
  static table = 'supplier_invoice_lines'

  declare outcome: LineOutcome | null

  @belongsTo(() => SupplierInvoice)
  declare supplierInvoice: BelongsTo<typeof SupplierInvoice>

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  @belongsTo(() => StockMovement)
  declare stockMovement: BelongsTo<typeof StockMovement>
}
