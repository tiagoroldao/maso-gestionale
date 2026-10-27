import Big from 'big.js'
import Item from '#models/item'
import StockLedger from '#stock/stock_ledger'
import { isBelowMarkup } from '#shared/money'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Items that need attention: negative stock, stock at or below the
 * reorder level, and resale prices now below the Category markup.
 */
export default class StockController {
  async index({ inertia }: HttpContext) {
    const items = await Item.query()
      .withScopes((scopes) => scopes.active())
      .preload('category')
      .orderBy(['code', 'id'])
    const levels = await StockLedger.levels()

    const rows = items.map((item) => {
      const stock = levels.get(item.id) ?? '0.000'
      return {
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        stock,
        reorderLevel: item.reorderLevel,
        purchasePrice: item.purchasePrice,
        resalePrice: item.resalePrice,
        markupPercent: item.category?.markupPercent ?? null,
        negative: new Big(stock).lt(0),
        low: item.reorderLevel !== null && new Big(stock).lte(item.reorderLevel),
        belowMarkup: item.category
          ? isBelowMarkup(item.purchasePrice, item.resalePrice, item.category.markupPercent)
          : false,
      }
    })

    return inertia.render('stock/index', {
      toReorder: rows.filter((row) => row.negative || row.low),
      belowMarkup: rows.filter((row) => row.belowMarkup),
    })
  }
}
