import db from '@adonisjs/lucid/services/db'
import PaymentTerms from '#models/payment_terms'
import { paymentTermsValidator } from '#validators/payment_terms'
import type { HttpContext } from '@adonisjs/core/http'

const FOREIGN_KEY_VIOLATION = '23503'

/**
 * The Admin's list of Payment Terms that Customers can be given.
 */
export default class PaymentTermsController {
  async index({ inertia }: HttpContext) {
    const terms = await PaymentTerms.query()
      .select('payment_terms.*')
      .select(
        db
          .from('customers')
          .count('*')
          .whereColumn('customers.payment_terms_id', 'payment_terms.id')
          .as('customer_count')
      )
      .orderBy('days')
      .orderBy('name')

    return inertia.render('settings/payment_terms', {
      paymentTerms: terms.map((term) => ({
        id: term.id,
        name: term.name,
        days: term.days,
        endOfMonth: term.endOfMonth,
        customerCount: Number(term.$extras.customer_count),
      })),
    })
  }

  async store({ request, response, session }: HttpContext) {
    const data = await request.validateUsing(paymentTermsValidator, { meta: {} })
    await PaymentTerms.create({ ...data, endOfMonth: data.endOfMonth ?? false })

    session.flash('success', 'Payment Terms added.')
    response.redirect().toRoute('payment_terms.index')
  }

  async update({ params, request, response, session }: HttpContext) {
    const terms = await PaymentTerms.findOrFail(params.id)
    const data = await request.validateUsing(paymentTermsValidator, { meta: { id: terms.id } })
    await terms.merge({ ...data, endOfMonth: data.endOfMonth ?? false }).save()

    session.flash('success', 'Payment Terms saved.')
    response.redirect().toRoute('payment_terms.index')
  }

  async destroy({ params, response, session }: HttpContext) {
    const terms = await PaymentTerms.findOrFail(params.id)
    const inUse = await db.from('customers').where('payment_terms_id', terms.id).first()
    const [{ total }] = await db.from('payment_terms').count('* as total')

    if (inUse) {
      session.flash('error', `${terms.name} is used by Customers and can't be deleted.`)
    } else if (Number(total) <= 1) {
      session.flash('error', 'There must always be at least one set of Payment Terms.')
    } else {
      try {
        await terms.delete()
        session.flash('success', `${terms.name} deleted.`)
      } catch (error) {
        // A Customer was given these terms after the check above
        if ((error as { code?: string }).code !== FOREIGN_KEY_VIOLATION) throw error
        session.flash('error', `${terms.name} is used by Customers and can't be deleted.`)
      }
    }
    response.redirect().toRoute('payment_terms.index')
  }
}
