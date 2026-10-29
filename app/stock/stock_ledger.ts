import Big from 'big.js'
import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Charge from '#models/charge'
import Item from '#models/item'
import Job from '#models/job'
import type User from '#models/user'
import StockMovement from '#models/stock_movement'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { ACTIVE_JOB_STATUSES } from '#shared/jobs'
import { QUANTITY_DECIMALS, available, stockQuantities, type StockQuantities } from '#shared/stock'
import { WORK_STATE_SQL } from '#services/job_status'

/**
 * The SQL equivalents of inStock(), committed() and available() for the
 * Item `alias`: the sum of its Stock Movements; the quantity on its
 * planned Item Charges on Jobs that take new work (isCommitted()), on
 * Visits and on the Job alike; and the first less the second.
 */
export const IN_STOCK_SQL = (alias: string) => `(SELECT coalesce(sum(sm.quantity), 0)
  FROM stock_movements sm WHERE sm.item_id = ${alias}.id)`

export const COMMITTED_SQL = (alias: string) => `(SELECT coalesce(sum(cc.quantity), 0)
  FROM charges cc JOIN jobs cj ON cj.id = cc.job_id
  WHERE cc.item_id = ${alias}.id AND cc.kind = 'item'
    AND cj.status IN (${ACTIVE_JOB_STATUSES.map((status) => `'${status}'`).join(', ')})
    AND ${WORK_STATE_SQL('cc')} = 'planned')`

export const AVAILABLE_SQL = (alias: string) => `(${IN_STOCK_SQL(alias)} - ${COMMITTED_SQL(alias)})`

type Common = {
  occurredOn: DateTime
  reference?: string | null
  user?: User | null
  /**
   * Joins the caller's transaction, so a Visit or Invoice and its Stock
   * Movements are saved together. The caller must then refresh any Item it
   * holds before saving it again, or it would put back the old purchase
   * price. When locking several Items, lock them in id order.
   */
  client?: TransactionClientContract
}

/**
 * The Warehouse's stock, kept as a ledger of Stock Movements. Every change
 * to stock goes through here; current stock is the sum of an Item's
 * movements and is never stored or edited directly. Negative stock is
 * allowed (work in the field must never be blocked by missing paperwork).
 */
export default class StockLedger {
  /**
   * Runs `work` in the caller's transaction when given one, otherwise in a
   * new transaction.
   */
  private static inTransaction<T>(
    client: TransactionClientContract | undefined,
    work: (trx: TransactionClientContract) => Promise<T>
  ) {
    return client ? work(client) : db.transaction(work)
  }

  /**
   * Goods received: adds stock and, when a unit cost is given and this is
   * the most recent receipt (by date, then entry order), makes it the Item's
   * purchase price. A backdated delivery note never replaces a newer cost.
   * The resale price is never touched.
   */
  static async receive(item: Item, input: Common & { quantity: string; unitCost?: string | null }) {
    const quantity = new Big(input.quantity)
    if (quantity.lte(0)) throw new RangeError('A receipt must add a positive quantity')

    const movement = await this.inTransaction(input.client, async (trx) => {
      // Serialises receipts for this Item, so "most recent" can't race
      await Item.query({ client: trx }).where('id', item.id).forUpdate().firstOrFail()

      const created = await StockMovement.create(
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

      if (created.unitCost) {
        const newer = await StockMovement.query({ client: trx })
          .where('itemId', item.id)
          .where('kind', 'receipt')
          .whereNotNull('unitCost')
          .whereNot('id', created.id)
          .where((query) => {
            query
              .where('occurredOn', '>', created.occurredOn.toISODate()!)
              .orWhere((sameDay) =>
                sameDay
                  .where('occurredOn', created.occurredOn.toISODate()!)
                  .where('id', '>', created.id)
              )
          })
          .first()

        if (!newer) {
          await Item.query({ client: trx })
            .where('id', item.id)
            .update({ purchase_price: created.unitCost, updated_at: new Date() })
        }
      }
      return created
    })

    if (movement.unitCost && !input.client) await item.refresh()
    return movement
  }

  /**
   * Items used on a Visit: removes stock (negative stock is allowed).
   */
  static async use(item: Item, input: Common & { quantity: string }) {
    const quantity = new Big(input.quantity)
    if (quantity.lte(0)) throw new RangeError('Usage must remove a positive quantity')

    return StockMovement.create(
      {
        itemId: item.id,
        kind: 'usage',
        quantity: quantity.neg().toFixed(QUANTITY_DECIMALS),
        occurredOn: input.occurredOn,
        reference: input.reference ?? null,
        createdBy: input.user?.id ?? null,
      },
      { client: input.client }
    )
  }

  /**
   * Items sold on an Invoice without a Visit: removes stock (negative
   * stock is allowed). The reference is the Invoice number.
   */
  static async sell(item: Item, input: Common & { quantity: string }) {
    const quantity = new Big(input.quantity)
    if (quantity.lte(0)) throw new RangeError('A sale must remove a positive quantity')

    return StockMovement.create(
      {
        itemId: item.id,
        kind: 'sale',
        quantity: quantity.neg().toFixed(QUANTITY_DECIMALS),
        occurredOn: input.occurredOn,
        reference: input.reference ?? null,
        createdBy: input.user?.id ?? null,
      },
      { client: input.client }
    )
  }

  /**
   * A correction after a stocktake, breakage or loss: adds or removes
   * stock. A reason is always required.
   */
  static async adjust(item: Item, input: Common & { quantity: string; reason: string }) {
    const quantity = new Big(input.quantity)
    if (quantity.eq(0)) throw new RangeError('An adjustment must change the quantity')
    if (!input.reason.trim()) throw new RangeError('An adjustment needs a reason')

    return StockMovement.create(
      {
        itemId: item.id,
        kind: 'adjustment',
        quantity: quantity.toFixed(QUANTITY_DECIMALS),
        occurredOn: input.occurredOn,
        reference: input.reference ?? null,
        reason: input.reason.trim(),
        createdBy: input.user?.id ?? null,
      },
      { client: input.client }
    )
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

  /**
   * In stock, committed and available for each of the given Items (all
   * Items when omitted), for lists: the first two read with IN_STOCK_SQL
   * and COMMITTED_SQL, available worked out from them (as AVAILABLE_SQL
   * does, without running both subqueries again).
   */
  static async quantities(itemIds?: number[]) {
    const query = db
      .from('items')
      .select('items.id')
      .select(db.raw(`${IN_STOCK_SQL('items')} AS in_stock`))
      .select(db.raw(`${COMMITTED_SQL('items')} AS committed`))
    if (itemIds) query.whereIn('items.id', itemIds)

    const rows: { id: number; in_stock: string; committed: string }[] = await query
    const fixed = (value: string) => new Big(value).toFixed(QUANTITY_DECIMALS)
    return new Map<number, StockQuantities>(
      rows.map((row) => [
        row.id,
        {
          inStock: fixed(row.in_stock),
          committed: fixed(row.committed),
          available: available(row.in_stock, row.committed),
        },
      ])
    )
  }

  /**
   * In stock, committed and available for one Item, worked out in
   * TypeScript (stockQuantities()) from its Stock Movements and Item
   * Charges, for its page.
   */
  static async quantitiesOf(item: Item): Promise<StockQuantities> {
    const movements = await StockMovement.query().where('itemId', item.id).select('quantity')
    const charges = await Charge.query()
      .where('itemId', item.id)
      .where('kind', 'item')
      .preload('events', (events) => events.orderBy('id'))
    const jobIds = [...new Set(charges.map((charge) => charge.jobId))]
    const jobs = jobIds.length ? await Job.query().whereIn('id', jobIds) : []
    const statusOf = new Map(jobs.map((job) => [job.id, job.status]))
    return stockQuantities(
      movements,
      charges.map((charge) => ({
        quantity: charge.quantity,
        work: charge.workState,
        jobStatus: statusOf.get(charge.jobId)!,
      }))
    )
  }

  /**
   * The given Items whose available quantity is below zero, by code, and
   * lower than `before` (their quantities before the change) when given:
   * the warning shown when planning, recording or importing work takes
   * them there (ADR 0016). Never a refusal.
   */
  static async shortages(itemIds: number[], before?: Map<number, StockQuantities>) {
    if (!itemIds.length) return []
    const quantities = await this.quantities(itemIds)
    const items = await Item.query().whereIn('id', itemIds).orderBy(['code', 'id'])
    return items.flatMap((item) => {
      const now = new Big(quantities.get(item.id)!.available)
      const was = before?.get(item.id)?.available
      const short = now.lt(0) && (was === undefined || now.lt(was))
      return short
        ? [{ code: item.code, unit: item.unit, available: now.toFixed(QUANTITY_DECIMALS) }]
        : []
    })
  }
}
