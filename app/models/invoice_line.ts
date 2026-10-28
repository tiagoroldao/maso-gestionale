import { belongsTo, manyToMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, ManyToMany } from '@adonisjs/lucid/types/relations'
import { InvoiceLineSchema } from '#database/schema'
import Charge from '#models/charge'
import Invoice from '#models/invoice'
import Item from '#models/item'
import VatCode from '#models/vat_code'
import type { TotalsLine } from '#shared/invoice_totals'

/**
 * One line of an Invoice: an Item or free text, priced, with the VAT
 * treatment copied from its VAT Code, and the Charges it bills, if any;
 * or a deduction taking back an Advance Invoice (a negative price,
 * `deductsInvoiceId` set).
 */
export default class InvoiceLine extends InvoiceLineSchema {
  static table = 'invoice_lines'

  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  @belongsTo(() => VatCode)
  declare vatCode: BelongsTo<typeof VatCode>

  /**
   * The Charges the line bills (ADR 0010), each in full.
   */
  @manyToMany(() => Charge, {
    pivotTable: 'invoice_line_charges',
    pivotTimestamps: { createdAt: 'created_at', updatedAt: false },
  })
  declare charges: ManyToMany<typeof Charge>

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
