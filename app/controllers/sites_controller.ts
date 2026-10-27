import db from '@adonisjs/lucid/services/db'
import Site from '#models/site'
import Customer from '#models/customer'
import { siteSearchValidator, siteValidator } from '#validators/site'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

const PER_PAGE = 25
const PICKER_LIMIT = 20

function toAttributes(data: Infer<typeof siteValidator>) {
  return {
    label: data.label ?? null,
    street: data.street,
    streetNumber: data.streetNumber ?? null,
    unit: data.unit ?? null,
    postalCode: data.postalCode,
    city: data.city,
    province: data.province,
    accessNotes: data.accessNotes ?? null,
  }
}

export default class SitesController {
  async index({ request, inertia }: HttpContext) {
    const { q, page = 1 } = await siteSearchValidator.validate(request.qs())

    const query = Site.query().withCount('customers')
    if (q) query.withScopes((scopes) => scopes.search(q))
    const results = await query.orderBy('city').orderBy('street').paginate(page, PER_PAGE)

    return inertia.render('sites/index', {
      q: q ?? '',
      sites: results.all().map((site) => ({
        id: site.id,
        summary: site.summary,
        customerCount: Number(site.$extras.customers_count),
      })),
      pagination: {
        currentPage: results.currentPage,
        lastPage: results.lastPage,
        total: results.total,
      },
    })
  }

  async create({ request, inertia }: HttpContext) {
    const customerId = Number(request.qs().customerId) || null
    const customer = customerId ? await Customer.find(customerId) : null

    return inertia.render('sites/form', {
      site: null,
      customers: [],
      forCustomer: customer ? { id: customer.id, displayName: customer.displayName } : null,
    })
  }

  async store({ request, response, session }: HttpContext) {
    const data = await request.validateUsing(siteValidator)
    const site = await Site.create(toAttributes(data))

    session.flash('success', 'Site saved.')
    if (data.customerId) {
      await site.related('customers').attach([data.customerId])
      return response.redirect().toRoute('customers.show', { id: data.customerId })
    }
    response.redirect().toRoute('sites.index')
  }

  async edit({ params, inertia }: HttpContext) {
    const site = await Site.query().where('id', params.id).preload('customers').firstOrFail()

    return inertia.render('sites/form', {
      site: {
        id: site.id,
        label: site.label,
        street: site.street,
        streetNumber: site.streetNumber,
        unit: site.unit,
        postalCode: site.postalCode,
        city: site.city,
        province: site.province,
        accessNotes: site.accessNotes,
      },
      customers: site.customers.map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
      })),
      forCustomer: null,
    })
  }

  async update({ params, request, response, session }: HttpContext) {
    const site = await Site.findOrFail(params.id)
    const data = await request.validateUsing(siteValidator)

    await site.merge(toAttributes(data)).save()

    session.flash('success', 'Site saved.')
    response.redirect().toRoute('sites.edit', { id: site.id })
  }

  /**
   * JSON for the Site picker: the Customer's linked Sites first (all of
   * them when there is no search term), then other matching Sites.
   */
  async search({ request }: HttpContext) {
    const { q, customerId } = await siteSearchValidator.validate(request.qs())

    const links = customerId
      ? await db.from('customer_site').where('customer_id', customerId).select('site_id')
      : []
    const linkedIds: number[] = links.map((link) => link.site_id)

    const linkedQuery = Site.query().whereIn('id', linkedIds)
    if (q) linkedQuery.withScopes((scopes) => scopes.search(q))
    const linked = await linkedQuery.orderBy('city').orderBy('street')

    const others = q
      ? await Site.query()
          .withScopes((scopes) => scopes.search(q))
          .whereNotIn('id', linkedIds)
          .orderBy('city')
          .orderBy('street')
          .limit(PICKER_LIMIT)
      : []

    return {
      sites: [
        ...linked.map((site) => ({ id: site.id, summary: site.summary, linked: true })),
        ...others.map((site) => ({ id: site.id, summary: site.summary, linked: false })),
      ],
    }
  }
}
