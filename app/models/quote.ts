import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { QuoteSchema } from '#database/schema'
import Job from '#models/job'
import QuoteLine from '#models/quote_line'
import { sumAmounts } from '#shared/money'
import { invoiceTotals } from '#shared/invoice_totals'
import type { CustomerSnapshot } from '#models/invoice'
import type { CompanyDetails } from '#documents/document_renderer'
import type { QuoteStatus } from '#shared/quotes'

export { QUOTE_STATUSES, type QuoteStatus } from '#shared/quotes'

/**
 * A priced proposal for a Job that the Customer accepts or declines.
 * Each priced line carries a VAT Code, as an Invoice line does.
 */
export default class Quote extends QuoteSchema {
  declare status: QuoteStatus
  // What the Customer received, copied when it was sent (null on drafts)
  declare customerSnapshot: CustomerSnapshot | null
  declare companySnapshot: CompanyDetails | null

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
