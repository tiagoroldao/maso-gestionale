import Big from 'big.js'
import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Item from '#models/item'
import type User from '#models/user'
import StockMovement from '#models/stock_movement'
import { UNIT_PRICE_DECIMALS } from '#shared/money'

const QUANTITY_DECIMALS = 3

type Common = { occurredOn: DateTime; reference?: string | null; user?: User | null }

/**
 * The Warehouse's stock, kept as a ledger of Stock Movements. Every change
 * to stock goes through here; current stock is the sum of an Item's
 * movements and is never stored or edited directly. Negative stock is
 * allowed (work in the field must never be blocked by missing paperwork).
 */
export default class StockLedger {
  /**
   * Goods received: adds stock and, when a unit cost is given, makes it the
   * Item's purchase price (the latest purchase price, PRD). The resale price
   * is never touched.
   */
  static async receive(item: Item, input: Common & { quantity: string; unitCost?: string | null }) {
    const quantity = new Big(input.quantity)
    if (quantity.lte(0)) throw new RangeError('A receipt must add a positive quantity')

    return db
      .transaction(async (trx) => {
        const movement = await StockMovement.create(
          {
            itemId: item.id,
            kind: 'receipt',
            quantity: quantity.toFixed(QUANTITY_DECIMALS),
            unitCost: input.unitCost ? new Big(input.unitCost).toFixed(UNIT_PRICE_DECIMALS) : null,
            occurredOn: input.occurredOn,
            reference: input.reference ?? null,
            createdBy: input.user?.id ?? null,
          },
          { client: trx }
        )

        if (movement.unitCost) {
          await Item.query({ client: trx })
            .where('id', item.id)
            .update({ purchase_price: movement.unitCost, updated_at: new Date() })
        }
        return movement
      })
      .then(async (movement) => {
        if (movement.unitCost) await item.refresh()
        return movement
      })
  }

  /**
   * A correction after a stocktake, breakage or loss: adds or removes
   * stock. A reason is always required.
   */
  static async adjust(item: Item, input: Common & { quantity: string; reason: string }) {
    const quantity = new Big(input.quantity)
    if (quantity.eq(0)) throw new RangeError('An adjustment must change the quantity')
    if (!input.reason.trim()) throw new RangeError('An adjustment needs a reason')

    return StockMovement.create({
      itemId: item.id,
      kind: 'adjustment',
      quantity: quantity.toFixed(QUANTITY_DECIMALS),
      occurredOn: input.occurredOn,
      reference: input.reference ?? null,
      reason: input.reason.trim(),
      createdBy: input.user?.id ?? null,
    })
  }

  /**
   * Current stock for each of the given Items (all Items when omitted),
   * as decimal strings. Items with no movements have "0.000".
   */
  static async levels(itemIds?: number[]) {
    const query = db
      .from('items')
      .leftJoin('stock_movements', 'stock_movements.item_id', 'items.id')
      .groupBy('items.id')
      .select('items.id')
      .select(db.raw('coalesce(sum(stock_movements.quantity), 0) as stock'))
    if (itemIds) query.whereIn('items.id', itemIds)

    const rows: { id: number; stock: string }[] = await query
    return new Map(rows.map((row) => [row.id, new Big(row.stock).toFixed(QUANTITY_DECIMALS)]))
  }

  static async levelOf(item: Item) {
    const levels = await this.levels([item.id])
    return levels.get(item.id) ?? '0.000'
  }
}
