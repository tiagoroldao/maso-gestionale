import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { QuoteSchema } from '#database/schema'
import Job from '#models/job'
import QuoteLine from '#models/quote_line'
import { sumAmounts } from '#shared/money'
import { invoiceTotals } from '#shared/invoice_totals'

export const QUOTE_STATUSES = ['draft', 'accepted', 'declined'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/**
 * A priced proposal for a Job that the Customer accepts or declines.
 * Each priced line carries a VAT Code, as an Invoice line does.
 */
export default class Quote extends QuoteSchema {
  declare status: QuoteStatus

  @belongsTo(() => Job)
  declare job: BelongsTo<typeof Job>

  @hasMany(() => QuoteLine)
  declare lines: HasMany<typeof QuoteLine>

  /**
   * The sum of the line totals before VAT (lines must be preloaded).
   */
  get taxable() {
    return sumAmounts(this.lines.flatMap((line) => (line.lineTotal ? [line.lineTotal] : [])))
  }

  /**
   * VAT summary and grand total, worked out as for an Invoice.
   */
  get totals() {
    return invoiceTotals(
      this.lines.flatMap((line) =>
        line.vatRate !== null && line.quantity !== null && line.unitPrice !== null
          ? [
              {
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                vatRate: line.vatRate,
                natura: line.natura,
              },
            ]
          : []
      )
    )
  }
}
