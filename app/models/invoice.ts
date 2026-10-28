import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { InvoiceSchema } from '#database/schema'
import Customer from '#models/customer'
import InvoiceLine from '#models/invoice_line'
import { invoiceTotals } from '#shared/invoice_totals'
import { formatInvoiceNumber } from '#shared/invoice_numbers'
import type { PaymentMethod } from '#shared/payments'

export const INVOICE_STATUSES = ['draft', 'finalised'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/**
 * The Customer as invoiced, copied when the Invoice is finalised.
 */
export type CustomerSnapshot = {
  type: string
  name: string
  firstName: string | null
  lastName: string | null
  vatNumber: string | null
  taxCode: string | null
  sdiCode: string
  pec: string | null
  street: string
  streetNumber: string | null
  postalCode: string
  city: string
  province: string
}

/**
 * The issuing company, copied from Company settings when finalised.
 */
export type CompanySnapshot = {
  name: string
  vatNumber: string
  taxCode: string | null
  taxRegime: string
  street: string
  streetNumber: string | null
  postalCode: string
  city: string
  province: string
  email: string | null
  phone: string | null
  iban: string | null
}

/**
 * A request for payment to a Customer. A draft has no number; finalising
 * numbers and dates it, copies the Customer and company onto it, and makes
 * it a fiscal document that no longer changes.
 */
export default class Invoice extends InvoiceSchema {
  declare status: InvoiceStatus
  declare customerSnapshot: CustomerSnapshot | null
  declare companySnapshot: CompanySnapshot | null
  declare paymentMethod: PaymentMethod | null

  /**
   * "12/2026" once finalised; drafts have no number.
   */
  get formattedNumber() {
    return this.number && this.year ? formatInvoiceNumber(this.number, this.year) : null
  }

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
