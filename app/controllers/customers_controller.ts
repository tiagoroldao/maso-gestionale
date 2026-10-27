import Customer from '#models/customer'
import PaymentTerms from '#models/payment_terms'
import { customerSearchValidator, customerValidator } from '#validators/customer'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

const PER_PAGE = 25

/**
 * Escapes LIKE wildcards so a search for "50%" matches literally.
 */
function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

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
  async index({ request, inertia }: HttpContext) {
    const { q, page = 1 } = await customerSearchValidator.validate(request.qs())

    const query = Customer.query()
    if (q) {
      const pattern = likePattern(q)
      query.where((builder) => {
        builder
          .whereILike('name', pattern)
          .orWhereRaw(`concat_ws(' ', first_name, last_name) ilike ?`, [pattern])
          .orWhereRaw(`concat_ws(' ', last_name, first_name) ilike ?`, [pattern])
          .orWhereILike('tax_code', pattern)
          .orWhereILike('vat_number', pattern)
      })
    }
    const results = await query
      .orderByRaw(`lower(coalesce(name, concat_ws(' ', last_name, first_name)))`)
      .paginate(page, PER_PAGE)

    return inertia.render('customers/index', {
      q: q ?? '',
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

  async create({ inertia }: HttpContext) {
    return inertia.render('customers/form', {
      customer: null,
      paymentTerms: await paymentTermsOptions(),
    })
  }

  async store({ request, response, session }: HttpContext) {
    const data = await request.validateUsing(customerValidator)
    const customer = await Customer.create(toAttributes(data))

    session.flash('success', `${customer.displayName} saved.`)
    response.redirect().toRoute('customers.index')
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

  async update({ params, request, response, session }: HttpContext) {
    const customer = await Customer.findOrFail(params.id)
    const data = await request.validateUsing(customerValidator)

    await customer.merge(toAttributes(data)).save()

    session.flash('success', `${customer.displayName} saved.`)
    response.redirect().toRoute('customers.index')
  }
}
