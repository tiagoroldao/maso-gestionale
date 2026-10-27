import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { StockMovementSchema } from '#database/schema'
import Item from '#models/item'
import User from '#models/user'

export const STOCK_MOVEMENT_KINDS = ['receipt', 'usage', 'sale', 'adjustment'] as const
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number]

/**
 * A recorded change to an Item's quantity in the Warehouse. Quantities are
 * signed decimal strings (ADR 0007); stock is only ever their sum.
 */
export default class StockMovement extends StockMovementSchema {
  static table = 'stock_movements'

  declare kind: StockMovementKind

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare author: BelongsTo<typeof User>
}
