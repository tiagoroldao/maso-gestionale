import Customer from '#models/customer'
import Invoice from '#models/invoice'
import { outstanding } from '#shared/payment_status'
import { sumAmounts } from '#shared/money'
import Archiving, { HasOpenJobsError } from '#services/archiving'
import PaymentTerms from '#models/payment_terms'
import { customerSearchValidator, customerValidator } from '#validators/customer'
import { customerPickerValidator } from '#validators/job'
import { jobRow } from '#services/job_rows'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'
import { likePattern } from '#services/search'

const PER_PAGE = 25

/**
 * Keeps only the fields that apply to the Customer's type, so switching
 * a company to a private individual doesn't leave a stale name behind.
 */
function toAttributes(data: Infer<typeof customerValidator>) {
  const isPrivate = data.type === 'private'
  return {
    type: data.type,
    firstName: isPrivate ? data.firstName! : null,
    lastName: isPrivate ? data.lastName! : null,
    name: isPrivate ? null : data.name!,
    vatNumber: isPrivate ? null : (data.vatNumber ?? null),
    taxCode: data.taxCode ?? null,
    sdiCode: data.sdiCode ?? '0000000',
    pec: data.pec ?? null,
    street: data.street,
    streetNumber: data.streetNumber ?? null,
    postalCode: data.postalCode,
    city: data.city,
    province: data.province,
    email: data.email ?? null,
    phone: data.phone ?? null,
    notes: data.notes ?? null,
    paymentTermsId: data.paymentTermsId,
  }
}

async function paymentTermsOptions() {
  const terms = await PaymentTerms.query().orderBy('days').orderBy('name')
  return terms.map((term) => ({ id: term.id, name: term.name }))
}

export default class CustomersController {
  async archive({ params, response, session, i18n }: HttpContext) {
    try {
      await Archiving.archiveCustomer(params.id)
      session.flash('success', i18n.t('flash.customerArchived'))
    } catch (error) {
      if (!(error instanceof HasOpenJobsError)) throw error
      session.flash('error', i18n.t('flash.hasOpenJobs'))
    }
    response.redirect().toRoute('customers.show', { id: params.id })
  }

  async restore({ params, response, session, i18n }: HttpContext) {
    await Archiving.restoreCustomer(params.id)
    session.flash('success', i18n.t('flash.customerRestored'))
    response.redirect().toRoute('customers.show', { id: params.id })
  }

  async index({ request, inertia }: HttpContext) {
    const { q, page = 1, archived = false } = await customerSearchValidator.validate(request.qs())

    const query = Customer.query()
    if (archived) query.whereNotNull('archived_at')
    else query.withScopes((scopes) => scopes.active())
    if (q) {
      const pattern = likePattern(q)
      // Tax IDs are stored without spaces or the IT country prefix
      const taxIdPattern = likePattern(q.replace(/\s+/g, '').replace(/^IT(?=\d{11}$)/i, ''))
      query.where((builder) => {
        builder
          .whereILike('name', pattern)
          .orWhereRaw(`concat_ws(' ', first_name, last_name) ilike ?`, [pattern])
          .orWhereRaw(`concat_ws(' ', last_name, first_name) ilike ?`, [pattern])
          .orWhereILike('tax_code', taxIdPattern)
          .orWhereILike('vat_number', taxIdPattern)
      })
    }
    const results = await query
      .orderByRaw(`lower(coalesce(name, concat_ws(' ', last_name, first_name))), id`)
      .paginate(page, PER_PAGE)

    return inertia.render('customers/index', {
      q: q ?? '',
      archived,
      customers: results.all().map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
        type: customer.type,
        vatNumber: customer.vatNumber,
        taxCode: customer.taxCode,
        city: customer.city,
        province: customer.province,
      })),
      pagination: {
        currentPage: results.currentPage,
        lastPage: results.lastPage,
        total: results.total,
      },
    })
  }

  async show({ params, inertia }: HttpContext) {
    const customer = await Customer.query()
      .where('id', params.id)
      .preload('paymentTerms')
      .preload('sites', (sites) => sites.orderBy('city').orderBy('street'))
      .preload('jobs', (jobs) =>
        jobs
          .withScopes((scopes) => scopes.withBillingState())
          .preload('site')
          .preload('visits')
          .preload('invoices', (invoices) => invoices.preload('payments'))
          .orderBy([
            { column: 'year', order: 'desc' },
            { column: 'sequence', order: 'desc' },
          ])
      )
      .firstOrFail()

    // Outstanding on the Customer's issued Invoices
    const issued = await Invoice.query()
      .where('customerId', customer.id)
      .whereNot('status', 'draft')
      .preload('payments')
    const balance = sumAmounts(
      issued.map((invoice) => outstanding(invoice.total ?? '0', invoice.paid))
    )

    return inertia.render('customers/show', {
      balance,
      customer: {
        id: customer.id,
        displayName: customer.displayName,
        type: customer.type,
        vatNumber: customer.vatNumber,
        taxCode: customer.taxCode,
        sdiCode: customer.sdiCode,
        pec: customer.pec,
        billingAddress: customer.toRecipient().addressLines,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
        paymentTerms: customer.paymentTerms.name,
        archived: customer.archivedAt !== null,
      },
      sites: customer.sites.map((site) => ({ id: site.id, summary: site.summary })),
      jobs: customer.jobs.map((job) => jobRow(job)),
    })
  }

  async create({ inertia }: HttpContext) {
    return inertia.render('customers/form', {
      customer: null,
      paymentTerms: await paymentTermsOptions(),
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(customerValidator)
    const customer = await Customer.create(toAttributes(data))

    session.flash('success', i18n.t('flash.customerSaved', { name: customer.displayName }))
    response.redirect().toRoute('customers.show', { id: customer.id })
  }

  async edit({ params, inertia }: HttpContext) {
    const customer = await Customer.findOrFail(params.id)

    return inertia.render('customers/form', {
      customer: {
        id: customer.id,
        type: customer.type,
        firstName: customer.firstName,
        lastName: customer.lastName,
        name: customer.name,
        vatNumber: customer.vatNumber,
        taxCode: customer.taxCode,
        sdiCode: customer.sdiCode,
        pec: customer.pec,
        street: customer.street,
        streetNumber: customer.streetNumber,
        postalCode: customer.postalCode,
        city: customer.city,
        province: customer.province,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
        paymentTermsId: customer.paymentTermsId,
      },
      paymentTerms: await paymentTermsOptions(),
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const customer = await Customer.findOrFail(params.id)
    const data = await request.validateUsing(customerValidator)

    await customer.merge(toAttributes(data)).save()

    session.flash('success', i18n.t('flash.customerSaved', { name: customer.displayName }))
    response.redirect().toRoute('customers.show', { id: customer.id })
  }

  /**
   * JSON for the Customer picker: matches by name or tax IDs.
   */
  async search({ request }: HttpContext) {
    const { q } = await customerPickerValidator.validate(request.qs())
    if (!q) return { customers: [] }

    const pattern = likePattern(q)
    const customers = await Customer.query()
      .withScopes((scopes) => scopes.active())
      .where((builder) => {
        builder
          .whereILike('name', pattern)
          .orWhereRaw(`concat_ws(' ', first_name, last_name) ilike ?`, [pattern])
          .orWhereRaw(`concat_ws(' ', last_name, first_name) ilike ?`, [pattern])
          .orWhereILike('tax_code', pattern)
          .orWhereILike('vat_number', pattern)
      })
      .orderByRaw(`lower(coalesce(name, concat_ws(' ', last_name, first_name))), id`)
      .limit(20)

    return {
      customers: customers.map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
        city: customer.city,
      })),
    }
  }
}
