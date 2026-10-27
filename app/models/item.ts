import { belongsTo, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { ItemSchema } from '#database/schema'
import Category from '#models/category'
import { likePattern } from '#services/search'

/**
 * A stocked article with a purchase price and an independently set resale
 * price. Prices are decimal strings (ADR 0007).
 */
export default class Item extends ItemSchema {
  @belongsTo(() => Category)
  declare category: BelongsTo<typeof Category>

  /**
   * Items still in use: archived Items keep their history but leave lists
   * and pickers.
   */
  static active = scope((query) => {
    query.whereNull('archived_at')
  })

  /**
   * Matches the code, the description or the supplier's code.
   */
  static search = scope((query, term: string) => {
    const pattern = likePattern(term)
    query.where((builder) => {
      builder
        .whereILike('code', pattern)
        .orWhereILike('description', pattern)
        .orWhereILike('supplier_code', pattern)
    })
  })

  /**
   * Whether anything else refers to this Item, so it must be archived
   * rather than deleted. Nothing does yet; stock, Visits and invoices will.
   */
  async isReferenced() {
    return false
  }
}
