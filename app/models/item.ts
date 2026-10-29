import db from '@adonisjs/lucid/services/db'
import { beforeCreate, belongsTo, hasMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { ItemSchema } from '#database/schema'
import Category from '#models/category'
import VatCode from '#models/vat_code'
import ItemDocument from '#models/item_document'
import { likePattern } from '#services/search'
import { itemFlagDefaults } from '#shared/items'

/**
 * A stocked article with a purchase price and an independently set resale
 * price. Prices are decimal strings (ADR 0007). Equipment Items become
 * Installed Equipment when their Charges are done; Groupable ones' Charges
 * may share an Invoice line (#176).
 */
export default class Item extends ItemSchema {
  /**
   * A new Item left without its Equipment or Groupable flag gets the
   * default (`itemFlagDefaults`); the Item form always sends both.
   */
  @beforeCreate()
  static applyFlagDefaults(item: Item) {
    const defaults = itemFlagDefaults({
      maintenanceIntervalMonths: item.maintenanceIntervalMonths ?? null,
      significantGood: item.significantGood ?? false,
    })
    item.equipment ??= defaults.equipment
    item.groupable ??= defaults.groupable
  }

  @belongsTo(() => Category)
  declare category: BelongsTo<typeof Category>

  /**
   * The VAT Code a direct sale of this Item defaults to.
   */
  @belongsTo(() => VatCode)
  declare vatCode: BelongsTo<typeof VatCode>

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
   * rather than deleted: Stock Movements, Installed Equipment, Quote lines
   * and Charges today, invoices later.
   */
  async isReferenced() {
    const references = await Promise.all(
      ['stock_movements', 'installed_equipment', 'quote_lines', 'charges'].map((table) =>
        db.from(table).where('item_id', this.id).first()
      )
    )
    return references.some(Boolean)
  }
}
