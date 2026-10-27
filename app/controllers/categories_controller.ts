import Category from '#models/category'
import { categoryValidator } from '#validators/item'
import { isUniqueViolation, isForeignKeyViolation } from '#services/database_errors'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The Admin's Categories, each with the markup used to suggest resale
 * prices. Changing a markup never changes existing Items' prices.
 */
export default class CategoriesController {
  async index({ inertia }: HttpContext) {
    const categories = await Category.query().withCount('items').orderBy('name')

    return inertia.render('settings/categories', {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        markupPercent: category.markupPercent,
        itemCount: Number(category.$extras.items_count),
      })),
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(categoryValidator, { meta: {} })
    try {
      await Category.create(data)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().toRoute('categories.index')
    }

    session.flash('success', i18n.t('flash.categoryAdded'))
    response.redirect().toRoute('categories.index')
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const category = await Category.findOrFail(params.id)
    const data = await request.validateUsing(categoryValidator, { meta: { id: category.id } })
    try {
      await category.merge(data).save()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().toRoute('categories.index')
    }

    session.flash('success', i18n.t('flash.categorySaved'))
    response.redirect().toRoute('categories.index')
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const category = await Category.findOrFail(params.id)
    const inUse = await category.related('items').query().first()

    if (inUse) {
      session.flash('error', i18n.t('flash.categoryInUse', { name: category.name }))
      return response.redirect().toRoute('categories.index')
    }

    try {
      await category.delete()
      session.flash('success', i18n.t('flash.categoryDeleted', { name: category.name }))
    } catch (error) {
      // An Item was given this Category after the check above
      if (!isForeignKeyViolation(error)) throw error
      session.flash('error', i18n.t('flash.categoryInUse', { name: category.name }))
    }
    response.redirect().toRoute('categories.index')
  }
}
