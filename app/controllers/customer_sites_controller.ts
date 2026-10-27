import Customer from '#models/customer'
import { linkSiteValidator } from '#validators/site'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Linking existing Sites to a Customer, and unlinking them.
 */
export default class CustomerSitesController {
  async store({ params, request, response, session }: HttpContext) {
    const customer = await Customer.findOrFail(params.customerId)
    const { siteId } = await request.validateUsing(linkSiteValidator)

    await customer.related('sites').sync([siteId], false)

    session.flash('success', 'Site linked.')
    response.redirect().toRoute('customers.show', { id: customer.id })
  }

  async destroy({ params, response, session }: HttpContext) {
    const customer = await Customer.findOrFail(params.customerId)
    await customer.related('sites').detach([params.siteId])

    session.flash('success', 'Site unlinked.')
    response.redirect().toRoute('customers.show', { id: customer.id })
  }
}
