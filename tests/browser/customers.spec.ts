import { test } from '@japa/runner'
import Customer from '#models/customer'
import { createUser } from '#tests/helpers/users'

test.group('Customers in the browser', () => {
  test('Office creates a company Customer and finds it by Partita IVA', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))

    const page = await visit('/customers/create')
    await page.getByLabel('Customer type').selectOption('company')
    await page.getByLabel('Company name').fill('Edilizia Bianchi S.p.A.')
    await page.getByLabel('Partita IVA').fill('01114601006')
    await page.getByLabel('Street', { exact: true }).fill('Corso Italia')
    await page.getByLabel('CAP').fill('10121')
    await page.getByLabel('Comune').fill('Torino')
    await page.getByLabel('Provincia').fill('TO')
    await page.getByRole('button', { name: 'Save customer' }).click()

    await page.waitForURL('**/customers')
    await page.getByLabel('Search customers').fill('01114601006')
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('cell', { name: 'Edilizia Bianchi S.p.A.' }).waitFor()

    const customer = await Customer.firstOrFail()
    assert.equal(customer.type, 'company')
  })
})
