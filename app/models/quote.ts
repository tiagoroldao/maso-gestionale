import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { QuoteSchema } from '#database/schema'
import Job from '#models/job'
import QuoteLine from '#models/quote_line'
import { sumAmounts } from '#shared/money'

export const QUOTE_STATUSES = ['draft', 'accepted', 'declined'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/**
 * A priced proposal for a Job that the Customer accepts or declines.
 * Amounts are VAT-exclusive until VAT codes exist (#17).
 */
export default class Quote extends QuoteSchema {
  declare status: QuoteStatus

  @belongsTo(() => Job)
  declare job: BelongsTo<typeof Job>

  @hasMany(() => QuoteLine)
  declare lines: HasMany<typeof QuoteLine>

  /**
   * The sum of the line totals (lines must be preloaded).
   */
  get total() {
    return sumAmounts(this.lines.flatMap((line) => (line.lineTotal ? [line.lineTotal] : [])))
  }
}
