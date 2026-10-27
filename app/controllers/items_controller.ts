import { DateTime } from 'luxon'
import Item from '#models/item'
import Category from '#models/category'
import { itemSearchValidator, itemValidator } from '#validators/item'
import { isUniqueViolation } from '#services/database_errors'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

const PER_PAGE = 25
const PICKER_LIMIT = 20

function toAttributes(data: Infer<typeof itemValidator>) {
  return {
    code: data.code,
    description: data.description,
    unit: data.unit,
    categoryId: data.categoryId ?? null,
    supplierName: data.supplierName ?? null,
    supplierCode: data.supplierCode ?? null,
    vatRate: data.vatRate,
    purchasePrice: data.purchasePrice,
    resalePrice: data.resalePrice,
  }
}

async function categoryOptions() {
  const categories = await Category.query().orderBy('name')
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    markupPercent: category.markupPercent,
  }))
}

export default class ItemsController {
  async index({ request, inertia }: HttpContext) {
    const { q, page = 1, archived = false } = await itemSearchValidator.validate(request.qs())

    const query = Item.query().preload('category')
    if (archived) query.whereNotNull('archived_at')
    else query.withScopes((scopes) => scopes.active())
    if (q) query.withScopes((scopes) => scopes.search(q))
    const results = await query.orderBy(['code', 'id']).paginate(page, PER_PAGE)

    return inertia.render('items/index', {
      q: q ?? '',
      archived,
      items: results.all().map((item) => ({
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        category: item.category?.name ?? null,
        purchasePrice: item.purchasePrice,
        resalePrice: item.resalePrice,
      })),
      pagination: {
        currentPage: results.currentPage,
        lastPage: results.lastPage,
        total: results.total,
      },
    })
  }

  async create({ inertia }: HttpContext) {
    return inertia.render('items/form', { item: null, categories: await categoryOptions() })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(itemValidator, { meta: {} })
    let item: Item
    try {
      item = await Item.create(toAttributes(data))
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().back()
    }

    session.flash('success', i18n.t('flash.itemSaved', { code: item.code }))
    response.redirect().toRoute('items.index')
  }

  async edit({ params, inertia }: HttpContext) {
    const item = await Item.findOrFail(params.id)

    return inertia.render('items/form', {
      item: {
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        categoryId: item.categoryId,
        supplierName: item.supplierName,
        supplierCode: item.supplierCode,
        vatRate: item.vatRate,
        purchasePrice: item.purchasePrice,
        resalePrice: item.resalePrice,
        archived: item.archivedAt !== null,
      },
      categories: await categoryOptions(),
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    const data = await request.validateUsing(itemValidator, { meta: { id: item.id } })

    try {
      await item.merge(toAttributes(data)).save()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().back()
    }

    session.flash('success', i18n.t('flash.itemSaved', { code: item.code }))
    response.redirect().toRoute('items.index')
  }

  /**
   * JSON for Item pickers, open to every business role. Prices are only
   * included for roles that may see them, so a Technician's picker never
   * receives them.
   */
  async search({ request, bouncer }: HttpContext) {
    const { q } = await itemSearchValidator.validate(request.qs())
    const withPrices = await bouncer.allows('seePrices')

    const query = Item.query()
      .withScopes((scopes) => scopes.active())
      .orderBy(['code', 'id'])
      .limit(PICKER_LIMIT)
    if (q) query.withScopes((scopes) => scopes.search(q))
    const items = await query

    return {
      items: items.map((item) => ({
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        ...(withPrices && {
          purchasePrice: item.purchasePrice,
          resalePrice: item.resalePrice,
          vatRate: item.vatRate,
        }),
      })),
    }
  }

  async archive({ params, response, session, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    item.archivedAt = DateTime.now()
    await item.save()

    session.flash('success', i18n.t('flash.itemArchived', { code: item.code }))
    response.redirect().toRoute('items.index')
  }

  async unarchive({ params, response, session, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    item.archivedAt = null
    await item.save()

    session.flash('success', i18n.t('flash.itemUnarchived', { code: item.code }))
    response.redirect().toRoute('items.edit', { id: item.id })
  }

  /**
   * Deletes an Item that was never used. Items referenced elsewhere (stock,
   * Visits, invoices) are archived instead, so their history stays intact.
   */
  async destroy({ params, response, session, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)

    if (await item.isReferenced()) {
      session.flash('error', i18n.t('flash.itemInUse', { code: item.code }))
      return response.redirect().back()
    }
    await item.delete()

    session.flash('success', i18n.t('flash.itemDeleted', { code: item.code }))
    response.redirect().toRoute('items.index')
  }
}
