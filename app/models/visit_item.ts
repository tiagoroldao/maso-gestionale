import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { VisitItemSchema } from '#database/schema'
import Item from '#models/item'

/**
 * An Item used on a Visit, taken off stock when the Visit is done.
 */
export default class VisitItem extends VisitItemSchema {
  static table = 'visit_items'

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>
}
