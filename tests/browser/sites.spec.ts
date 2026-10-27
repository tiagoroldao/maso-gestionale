import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'

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
    await page.getByLabel('Link an existing Site').fill('centrale')
    await page.getByRole('option', { name: /Centrale termica/ }).click()
    await page.getByRole('cell', { name: /Centrale termica/ }).waitFor()

    await page.getByRole('link', { name: 'New Site for this Customer' }).click()
    await page.getByLabel('Street', { exact: true }).fill('Via Verdi')
    await page.getByLabel('Street number').fill('10')
    await page.getByLabel('Unit').fill('int. 7')
    await page.getByLabel('CAP').fill('20121')
    await page.getByLabel('Comune').fill('Milano')
    await page.getByLabel('Provincia').fill('MI')
    await page.getByRole('button', { name: 'Save site' }).click()

    await page.waitForURL(`**/customers/${customer.id}`)
    await page.getByRole('cell', { name: /int\. 7/ }).waitFor()
    await customer.load('sites')
    assert.lengthOf(customer.sites, 2)
  })
})
