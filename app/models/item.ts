import db from '@adonisjs/lucid/services/db'
import { belongsTo, hasMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { ItemSchema } from '#database/schema'
import Category from '#models/category'
import ItemDocument from '#models/item_document'
import { likePattern } from '#services/search'

/**
 * A stocked article with a purchase price and an independently set resale
 * price. Prices are decimal strings (ADR 0007).
 */
export default class Item extends ItemSchema {
  @belongsTo(() => Category)
  declare category: BelongsTo<typeof Category>

  @hasMany(() => ItemDocument)
  declare documents: HasMany<typeof ItemDocument>

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
   * rather than deleted: Stock Movements and Installed Equipment today,
   * Visits and invoices later.
   */
  async isReferenced() {
    const [movement, equipment] = await Promise.all([
      db.from('stock_movements').where('item_id', this.id).first(),
      db.from('installed_equipment').where('item_id', this.id).first(),
    ])
    return Boolean(movement || equipment)
  }
}
