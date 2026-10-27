import Item from '#models/item'
import StockLedger from '#stock/stock_ledger'
import { adjustmentValidator, receiptValidator } from '#validators/stock'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Recording goods received and stock adjustments for an Item.
 */
export default class StockMovementsController {
  async receive({ params, request, response, session, auth, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    const data = await request.validateUsing(receiptValidator)

    await StockLedger.receive(item, { ...data, user: auth.user })

    session.flash('success', i18n.t('flash.stockReceived'))
    response.redirect().toRoute('items.show', { id: item.id })
  }

  async adjust({ params, request, response, session, auth, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    const data = await request.validateUsing(adjustmentValidator)

    await StockLedger.adjust(item, { ...data, user: auth.user })

    session.flash('success', i18n.t('flash.stockAdjusted'))
    response.redirect().toRoute('items.show', { id: item.id })
  }
}
