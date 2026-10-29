import type { HttpContext } from '@adonisjs/core/http'
import StockLedger from '#stock/stock_ledger'
import { formatQuantity, type StockQuantities } from '#shared/stock'

/**
 * Flashes `success` after planning, recording or importing work on the
 * given Items, as a warning instead when it left any of them with less
 * than nothing available (ADR 0016): the work stands, never refused, and
 * the warning names each Item short. With `before` (their quantities
 * before the change), only an Item the change took lower counts, so a
 * correction to an Item already short doesn't warn again.
 */
export async function flashWithStockWarning(
  { session, i18n }: Pick<HttpContext, 'session' | 'i18n'>,
  itemIds: number[],
  success: string,
  before?: Map<number, StockQuantities>
) {
  const short = await StockLedger.shortages([...new Set(itemIds)], before)
  if (!short.length) {
    session.flash('success', success)
    return
  }
  const items = short
    .map((item) => `${item.code} (${formatQuantity(item.available)} ${item.unit})`)
    .join(', ')
  session.flash('warning', `${success} ${i18n.t('flash.belowAvailable', { items })}`)
}
