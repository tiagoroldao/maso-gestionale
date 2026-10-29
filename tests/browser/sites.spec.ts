import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { it } from '#tests/helpers/i18n'

test.group('Sites in the browser', () => {
  test('Office links an existing Site and creates a new one from a Customer', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ name: 'Condominio Verdi' })
    await createSite({ label: 'Centrale termica', street: 'Via Verdi', city: 'Milano' })

    const page = await visit(`/customers/${customer.id}`)
    await page.getByLabel(it('ui.customers.linkSite')).fill('centrale')
    await page.getByRole('option', { name: /Centrale termica/ }).click()
    await page.getByRole('cell', { name: /Centrale termica/ }).waitFor()

    await page.getByRole('link', { name: it('ui.customers.newSite') }).click()
    await page.getByLabel(it('ui.address.street'), { exact: true }).fill('Via Verdi')
    await page.getByLabel(it('ui.address.streetNumber')).fill('10')
    await page.getByLabel(it('ui.sites.unit')).fill('int. 7')
    await page.getByLabel(it('ui.address.postalCode')).fill('20121')
    await page.getByLabel(it('ui.address.city')).fill('Milano')
    await page.getByLabel(it('ui.address.province')).fill('MI')
    await page.getByRole('button', { name: it('ui.sites.save') }).click()

    await page.waitForURL(`**/customers/${customer.id}`)
    await page.getByRole('cell', { name: /int\. 7/ }).waitFor()
    await customer.load('sites')
    assert.lengthOf(customer.sites, 2)
  })

  test('a Site archived after it was offered is not linked, and the page says why', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ name: 'Condominio Verdi' })
    const site = await createSite({
      label: 'Centrale termica',
      street: 'Via Verdi',
      city: 'Milano',
    })

    const page = await visit(`/customers/${customer.id}`)
    await page.getByLabel(it('ui.customers.linkSite')).fill('centrale')
    const option = page.getByRole('option', { name: /Centrale termica/ })
    await option.waitFor()
    await site.merge({ archivedAt: DateTime.now() }).save()
    await option.click()

    await page
      .getByText(it('validator.shared.messages.database.exists', { field: 'immobile' }))
      .waitFor()
    await customer.load('sites')
    assert.lengthOf(customer.sites, 0)
  })
})
