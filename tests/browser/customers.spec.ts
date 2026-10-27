import { test } from '@japa/runner'
import Customer from '#models/customer'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('Customers in the browser', () => {
  test('Office creates a company Customer and finds it by Partita IVA', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))

    const page = await visit('/customers/create')
    await page.getByLabel(it('ui.customers.typeLabel')).selectOption('company')
    await page.getByLabel(it('ui.customers.companyName')).fill('Edilizia Bianchi S.p.A.')
    await page.getByLabel(it('ui.customers.vatNumber')).fill('01114601006')
    await page.getByLabel(it('ui.address.street'), { exact: true }).fill('Corso Italia')
    await page.getByLabel(it('ui.address.postalCode')).fill('10121')
    await page.getByLabel(it('ui.address.city')).fill('Torino')
    await page.getByLabel(it('ui.address.province')).fill('TO')
    await page.getByRole('button', { name: it('ui.customers.save') }).click()

    await page.waitForURL(/\/customers\/\d+$/)
    const list = await visit('/customers')
    await list.getByLabel(it('ui.customers.searchLabel')).fill('01114601006')
    await list.getByRole('button', { name: it('ui.common.search') }).click()
    await list.getByRole('cell', { name: 'Edilizia Bianchi S.p.A.' }).waitFor()

    const customer = await Customer.firstOrFail()
    assert.equal(customer.type, 'company')
  })
})
