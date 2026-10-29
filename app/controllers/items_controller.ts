import { unlink } from 'node:fs/promises'
import { DateTime } from 'luxon'
import Item from '#models/item'
import Category from '#models/category'
import VatCode from '#models/vat_code'
import StockMovement from '#models/stock_movement'
import StockLedger from '#stock/stock_ledger'
import { isBelowMarkup } from '#shared/money'
import { itemSearchValidator, itemValidator } from '#validators/item'
import { isForeignKeyViolation, isUniqueViolation } from '#services/database_errors'
import { storagePath } from '#services/storage'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

const PER_PAGE = 25
const PICKER_LIMIT = 20
const MOVEMENT_HISTORY = 100

function toAttributes(data: Infer<typeof itemValidator>) {
  return {
    code: data.code,
    description: data.description,
    unit: data.unit,
    categoryId: data.categoryId ?? null,
    supplierName: data.supplierName ?? null,
    supplierCode: data.supplierCode ?? null,
    vatCodeId: data.vatCodeId,
    significantGood: data.significantGood ?? false,
    purchasePrice: data.purchasePrice,
    resalePrice: data.resalePrice,
    reorderLevel: data.reorderLevel ?? null,
    maintenanceIntervalMonths: data.maintenanceIntervalMonths ?? null,
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

/**
 * Active VAT Codes, plus the one the Item already has if it was archived.
 */
async function vatCodeOptions(current?: number) {
  const codes = await VatCode.query()
    .where((q) => q.withScopes((scopes) => scopes.active()).orWhere('id', current ?? 0))
    .orderBy([
      { column: 'rate', order: 'desc' },
      { column: 'name', order: 'asc' },
    ])
  return codes.map((code) => ({ id: code.id, name: code.name }))
}

export default class ItemsController {
  async index({ request, inertia }: HttpContext) {
    const { q, page = 1, archived = false } = await itemSearchValidator.validate(request.qs())

    const query = Item.query().preload('category')
    if (archived) query.whereNotNull('archived_at')
    else query.withScopes((scopes) => scopes.active())
    if (q) query.withScopes((scopes) => scopes.search(q))
    const results = await query.orderBy(['code', 'id']).paginate(page, PER_PAGE)
    const quantities = await StockLedger.quantities(results.all().map((item) => item.id))

    return inertia.render('items/index', {
      q: q ?? '',
      archived,
      items: results.all().map((item) => ({
        ...quantities.get(item.id)!,
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
    return inertia.render('items/form', {
      item: null,
      documents: [],
      categories: await categoryOptions(),
      vatCodes: await vatCodeOptions(),
    })
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
    response.redirect().toRoute('items.show', { id: item.id })
  }

  /**
   * The Item with its stock (in stock, committed, available) and Stock
   * Movement history.
   */
  async show({ params, inertia }: HttpContext) {
    const item = await Item.query()
      .where('id', params.id)
      .preload('category')
      .preload('documents', (documents) => documents.orderBy('title'))
      .firstOrFail()
    const movements = await StockMovement.query()
      .where('itemId', item.id)
      .preload('author')
      .orderBy([
        { column: 'occurred_on', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(MOVEMENT_HISTORY)

    return inertia.render('items/show', {
      item: {
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        category: item.category?.name ?? null,
        supplierName: item.supplierName,
        supplierCode: item.supplierCode,
        purchasePrice: item.purchasePrice,
        resalePrice: item.resalePrice,
        reorderLevel: item.reorderLevel,
        belowMarkup: item.category
          ? isBelowMarkup(item.purchasePrice, item.resalePrice, item.category.markupPercent)
          : false,
        markupPercent: item.category?.markupPercent ?? null,
      },
      stock: await StockLedger.quantitiesOf(item),
      documents: item.documents.map((document) => ({ id: document.id, title: document.title })),
      movements: movements.map((movement) => ({
        id: movement.id,
        kind: movement.kind,
        quantity: movement.quantity,
        unitCost: movement.unitCost,
        occurredOn: movement.occurredOn.toISODate()!,
        reference: movement.reference,
        reason: movement.reason,
        author: movement.author?.fullName ?? movement.author?.email ?? null,
      })),
    })
  }

  async edit({ params, inertia }: HttpContext) {
    const item = await Item.query()
      .where('id', params.id)
      .preload('documents', (documents) => documents.orderBy('title'))
      .firstOrFail()

    return inertia.render('items/form', {
      item: {
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        categoryId: item.categoryId,
        supplierName: item.supplierName,
        supplierCode: item.supplierCode,
        vatCodeId: item.vatCodeId,
        significantGood: item.significantGood,
        purchasePrice: item.purchasePrice,
        resalePrice: item.resalePrice,
        archived: item.archivedAt !== null,
        reorderLevel: item.reorderLevel,
        maintenanceIntervalMonths: item.maintenanceIntervalMonths,
      },
      documents: item.documents.map((document) => ({
        id: document.id,
        title: document.title,
        originalName: document.originalName,
        sizeBytes: document.sizeBytes,
      })),
      categories: await categoryOptions(),
      vatCodes: await vatCodeOptions(item.vatCodeId),
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    const data = await request.validateUsing(itemValidator, {
      meta: { id: item.id, vatCodeId: item.vatCodeId },
    })

    try {
      await item.merge(toAttributes(data)).save()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().back()
    }

    session.flash('success', i18n.t('flash.itemSaved', { code: item.code }))
    response.redirect().toRoute('items.show', { id: item.id })
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
      .preload('vatCode')
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
        maintenanceIntervalMonths: item.maintenanceIntervalMonths,
        significantGood: item.significantGood,
        ...(withPrices && {
          purchasePrice: item.purchasePrice,
          resalePrice: item.resalePrice,
          // An archived code is no longer a default for new lines
          vatCodeId: item.vatCode.archivedAt ? null : item.vatCodeId,
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
    const documents = await item.related('documents').query()
    const files = documents.map((document) => document.filePath)
    try {
      await item.delete()
    } catch (error) {
      // Something started using the Item after the check above
      if (!isForeignKeyViolation(error)) throw error
      session.flash('error', i18n.t('flash.itemInUse', { code: item.code }))
      return response.redirect().back()
    }

    // The documents' rows went with the Item; remove their files too
    await Promise.all(files.map((file) => unlink(storagePath(file)).catch(() => {})))

    session.flash('success', i18n.t('flash.itemDeleted', { code: item.code }))
    response.redirect().toRoute('items.index')
  }
}
