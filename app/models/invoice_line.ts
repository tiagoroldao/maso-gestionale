import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { InvoiceLineSchema } from '#database/schema'
import Item from '#models/item'
import VatCode from '#models/vat_code'
import type { TotalsLine } from '#shared/invoice_totals'

/**
 * One line of an Invoice: an Item or free text, priced, with the VAT
 * treatment copied from its VAT Code; or a deduction taking back an
 * Advance Invoice (a negative price, `deductsInvoiceId` set).
 */
export default class InvoiceLine extends InvoiceLineSchema {
  static table = 'invoice_lines'

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  @belongsTo(() => VatCode)
  declare vatCode: BelongsTo<typeof VatCode>

  /**
   * The line as invoiceTotals() reads it.
   */
  get totalsLine(): TotalsLine {
    return {
      quantity: this.quantity,
      unitPrice: this.unitPrice,
      discountPercent: this.discountPercent,
      vatRate: this.vatRate,
      natura: this.natura,
      deduction: this.deductsInvoiceId !== null,
    }
  }
}
