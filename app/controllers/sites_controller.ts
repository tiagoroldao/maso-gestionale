import db from '@adonisjs/lucid/services/db'
import Site from '#models/site'
import Archiving, { HasOpenJobsError } from '#services/archiving'
import Customer from '#models/customer'
import { siteSearchValidator, siteValidator } from '#validators/site'
import { jobRow } from '#services/job_rows'
import IssuedDocuments from '#services/issued_documents'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

const PER_PAGE = 25
const PICKER_LIMIT = 20

/**
 * Address order with a final tie-breaker, so flats in the same building
 * keep a stable order across pages.
 */
const ADDRESS_ORDER = ['city', 'street', 'street_number', 'unit', 'id']

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
    residential: data.residential ?? false,
  }
}

export default class SitesController {
  async archive({ params, response, session, i18n }: HttpContext) {
    try {
      await Archiving.archiveSite(params.id)
      session.flash('success', i18n.t('flash.siteArchived'))
    } catch (error) {
      if (!(error instanceof HasOpenJobsError)) throw error
      session.flash('error', i18n.t('flash.hasOpenJobs'))
    }
    response.redirect().toRoute('sites.show', { id: params.id })
  }

  async restore({ params, response, session, i18n }: HttpContext) {
    await Archiving.restoreSite(params.id)
    session.flash('success', i18n.t('flash.siteRestored'))
    response.redirect().toRoute('sites.show', { id: params.id })
  }

  async index({ request, inertia }: HttpContext) {
    const { q, page = 1, archived = false } = await siteSearchValidator.validate(request.qs())

    const query = Site.query().withCount('customers')
    if (archived) query.whereNotNull('archived_at')
    else query.withScopes((scopes) => scopes.active())
    if (q) query.withScopes((scopes) => scopes.search(q))
    const results = await query.orderBy(ADDRESS_ORDER).paginate(page, PER_PAGE)

    return inertia.render('sites/index', {
      q: q ?? '',
      archived,
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

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(siteValidator)
    const site = await db.transaction(async (trx) => {
      const created = await Site.create(toAttributes(data), { client: trx })
      if (data.customerId) await created.related('customers').attach([data.customerId])
      return created
    })

    session.flash('success', i18n.t('flash.siteSaved'))
    if (data.customerId) {
      return response.redirect().toRoute('customers.show', { id: data.customerId })
    }
    response.redirect().toRoute('sites.show', { id: site.id })
  }

  /**
   * The Site's history: its Customers and Installed Equipment (Jobs and
   * documents are added by later features).
   */
  async show({ params, inertia }: HttpContext) {
    const site = await Site.query()
      .where('id', params.id)
      .preload('customers')
      .preload('jobs', (jobs) =>
        jobs
          .withScopes((scopes) => scopes.withBillingState())
          .preload('customer')
          .preload('visits')
          .preload('invoices', (invoices) => invoices.preload('payments'))
          .orderBy([
            { column: 'year', order: 'desc' },
            { column: 'sequence', order: 'desc' },
          ])
      )
      .preload('installedEquipment', (equipment) =>
        equipment
          .orderBy(['equipment_type', 'id'])
          .preload('item', (item) => item.withCount('documents'))
      )
      .firstOrFail()

    const equipmentRow = (equipment: (typeof site.installedEquipment)[number]) => ({
      id: equipment.id,
      removedOn: equipment.removedOn?.toISODate() ?? null,
      replacedBy:
        site.installedEquipment.find((other) => other.id === equipment.replacedById)?.description ??
        null,
      description: equipment.description,
      serialNumber: equipment.serialNumber,
      installedOn: equipment.installedOn?.toISODate() ?? null,
      maintenanceIntervalMonths: equipment.maintenanceIntervalMonths,
      nextDueOn: equipment.nextDueOn?.toISODate() ?? null,
      itemCode: equipment.item?.code ?? null,
      documentCount: equipment.item ? Number(equipment.item.$extras.documents_count) : 0,
    })

    return inertia.render('sites/show', {
      site: {
        id: site.id,
        summary: site.summary,
        accessNotes: site.accessNotes,
        archived: site.archivedAt !== null,
      },
      customers: site.customers.map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
      })),
      jobs: site.jobs.map((job) => jobRow(job)),
      installedEquipment: site.installedEquipment
        .filter((equipment) => !equipment.removedOn)
        .map((equipment) => equipmentRow(equipment)),
      removedEquipment: site.installedEquipment
        .filter((equipment) => equipment.removedOn)
        .map((equipment) => equipmentRow(equipment)),
      issuedDocuments: await IssuedDocuments.history({ siteId: site.id }),
    })
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
        residential: site.residential,
      },
      customers: site.customers.map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
      })),
      forCustomer: null,
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const site = await Site.findOrFail(params.id)
    const data = await request.validateUsing(siteValidator)

    await site.merge(toAttributes(data)).save()

    session.flash('success', i18n.t('flash.siteSaved'))
    response.redirect().toRoute('sites.show', { id: site.id })
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

    const linkedQuery = Site.query()
      .withScopes((scopes) => scopes.active())
      .whereIn('id', linkedIds)
    if (q) linkedQuery.withScopes((scopes) => scopes.search(q))
    const linked = await linkedQuery.orderBy(ADDRESS_ORDER)

    const others = q
      ? await Site.query()
          .withScopes((scopes) => scopes.active())
          .withScopes((scopes) => scopes.search(q))
          .whereNotIn('id', linkedIds)
          .orderBy(ADDRESS_ORDER)
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
