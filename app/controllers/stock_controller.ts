import Item from '#models/item'
import StockLedger from '#stock/stock_ledger'
import { isBelowMarkup } from '#shared/money'
import { reorderReason } from '#shared/stock'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Items that need attention: available below zero, or at or below the
 * reorder level (ADR 0016: what is committed to planned work is already
 * spoken for), and resale prices now below the Category markup.
 */
export default class StockController {
  async index({ inertia }: HttpContext) {
    const items = await Item.query()
      .withScopes((scopes) => scopes.active())
      .preload('category')
      .orderBy(['code', 'id'])
    const quantities = await StockLedger.quantities(items.map((item) => item.id))

    const rows = items.map((item) => {
      const stock = quantities.get(item.id)!
      return {
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        ...stock,
        reorderLevel: item.reorderLevel,
        reorder: reorderReason(stock.available, item.reorderLevel),
        purchasePrice: item.purchasePrice,
        resalePrice: item.resalePrice,
        markupPercent: item.category?.markupPercent ?? null,
        belowMarkup: item.category
          ? isBelowMarkup(item.purchasePrice, item.resalePrice, item.category.markupPercent)
          : false,
      }
    })

    return inertia.render('stock/index', {
      toReorder: rows.filter((row) => row.reorder !== null),
      belowMarkup: rows.filter((row) => row.belowMarkup),
    })
  }
}
