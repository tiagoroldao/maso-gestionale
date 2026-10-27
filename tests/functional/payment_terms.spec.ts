import { test } from '@japa/runner'
import PaymentTerms from '#models/payment_terms'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { it } from '#tests/helpers/i18n'

test.group('Payment Terms', () => {
  test('there are immediate-payment terms from the start', async ({ assert }) => {
    const terms = await PaymentTerms.findByOrFail('name', 'Rimessa diretta')
    assert.equal(terms.days, 0)
  })

  test('the Admin adds and edits Payment Terms', async ({ client, assert }) => {
    const admin = await createUser('admin')

    await client
      .post('/settings/payment-terms')
      .form({ name: '30 gg fine mese', days: '30', endOfMonth: 'true' })
      .withCsrfToken()
      .loginAs(admin)
    const terms = await PaymentTerms.findByOrFail('name', '30 gg fine mese')
    assert.equal(terms.days, 30)
    assert.isTrue(terms.endOfMonth)

    await client
      .put(`/settings/payment-terms/${terms.id}`)
      .form({ name: '60 gg', days: '60' })
      .withCsrfToken()
      .loginAs(admin)
    await terms.refresh()
    assert.equal(terms.name, '60 gg')
    assert.isFalse(terms.endOfMonth)
  })

  test('rejects duplicate names and negative days', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/payment-terms')
      .form({ name: 'rimessa diretta', days: '-1' })
      .header('referer', '/settings/payment-terms')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['name', 'days'])
  })

  test('deletes unused terms but keeps terms used by Customers', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const unused = await PaymentTerms.create({ name: 'Unused', days: 10, endOfMonth: false })
    const customer = await createCustomer()

    await client.delete(`/settings/payment-terms/${unused.id}`).withCsrfToken().loginAs(admin)
    assert.isNull(await PaymentTerms.find(unused.id))

    const response = await client
      .delete(`/settings/payment-terms/${customer.paymentTermsId}`)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    response.assertFlashMessage('error', it('flash.paymentTermsInUse', { name: 'Rimessa diretta' }))
    assert.isNotNull(await PaymentTerms.find(customer.paymentTermsId))
  })

  test('the last Payment Terms can not be deleted', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const immediate = await PaymentTerms.findByOrFail('name', 'Rimessa diretta')

    const response = await client
      .delete(`/settings/payment-terms/${immediate.id}`)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.paymentTermsLast'))
    assert.isNotNull(await PaymentTerms.find(immediate.id))
  })

  test('only the Admin manages Payment Terms', async ({ client }) => {
    for (const role of ['office', 'technician'] as const) {
      const user = await createUser(role)
      const response = await client.get('/settings/payment-terms').withInertia().loginAs(user)
      response.assertStatus(403)
    }
  })
})
