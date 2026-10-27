import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { InvoiceSchema } from '#database/schema'
import Customer from '#models/customer'
import InvoiceLine from '#models/invoice_line'
import { invoiceTotals } from '#shared/invoice_totals'

export const INVOICE_STATUSES = ['draft'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/**
 * A request for payment to a Customer. A draft has no number; finalising
 * (#19) numbers it and makes it a fiscal document.
 */
export default class Invoice extends InvoiceSchema {
  declare status: InvoiceStatus

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @hasMany(() => InvoiceLine)
  declare lines: HasMany<typeof InvoiceLine>

  /**
   * Totals and VAT summary, from the preloaded lines.
   */
  get totals() {
    return invoiceTotals(
      this.lines.map((line) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        vatRate: line.vatRate,
        natura: line.natura,
      })),
      this.discountPercent
    )
  }
}
