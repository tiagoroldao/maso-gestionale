import Supplier from '#models/supplier'
import { isUniqueViolation } from '#services/database_errors'
import { saveActions } from '#shared/screen_actions'
import { newSupplierValidator, pageValidator, supplierValidator } from '#validators/supplier'
import type { Infer } from '@vinejs/vine/types'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

/**
 * Suppliers (#198), for Admin and Office: listed by name, created by hand
 * (they are also created when their first invoice arrives), and their
 * details corrected. A Supplier's VAT number never changes: its invoices
 * carry it.
 */
export default class SuppliersController {
  async index({ request, inertia }: HttpContext) {
    const { page = 1 } = await pageValidator.validate(request.qs())
    const results = await Supplier.query()
      .withCount('invoices')
      .orderByRaw('lower(name), id')
      .paginate(page, PER_PAGE)

    return inertia.render('suppliers/index', {
      suppliers: results.all().map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        vatId: `${supplier.vatCountry}${supplier.vatNumber}`,
        city: supplier.city,
        invoices: Number(supplier.$extras.invoices_count),
      })),
      pagination: {
        currentPage: results.currentPage,
        lastPage: results.lastPage,
        total: results.total,
      },
    })
  }

  async create({ inertia, i18n }: HttpContext) {
    return inertia.render('suppliers/form', {
      actions: saveActions(i18n.t('ui.suppliers.create')),
      supplier: null,
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(newSupplierValidator)
    try {
      await Supplier.create({ ...data, ...detailsOf(data) })
    } catch (error) {
      // Two people adding the same Supplier at once
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.supplierExists'))
      return response.redirect().back()
    }
    session.flash('success', i18n.t('flash.supplierCreated'))
    return response.redirect().toRoute('suppliers.index')
  }

  async edit({ params, inertia, i18n }: HttpContext) {
    const supplier = await Supplier.findOrFail(params.id)
    return inertia.render('suppliers/form', {
      actions: saveActions(i18n.t('ui.suppliers.save')),
      supplier: {
        id: supplier.id,
        name: supplier.name,
        vatCountry: supplier.vatCountry,
        vatNumber: supplier.vatNumber,
        taxCode: supplier.taxCode,
        street: supplier.street,
        postalCode: supplier.postalCode,
        city: supplier.city,
        province: supplier.province,
        email: supplier.email,
        phone: supplier.phone,
      },
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const supplier = await Supplier.findOrFail(params.id)
    const data = await request.validateUsing(supplierValidator)
    await supplier.merge(detailsOf(data)).save()
    session.flash('success', i18n.t('flash.supplierSaved'))
    return response.redirect().toRoute('suppliers.index')
  }
}

/** The details as stored: a field left empty is cleared */
function detailsOf(data: Infer<typeof supplierValidator>) {
  return {
    name: data.name,
    taxCode: data.taxCode ?? null,
    street: data.street || null,
    postalCode: data.postalCode || null,
    city: data.city || null,
    province: data.province ?? null,
    email: data.email ?? null,
    phone: data.phone || null,
  }
}
