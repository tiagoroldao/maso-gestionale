import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { createSite } from '#tests/helpers/sites'

test.group('Installed Equipment in the browser', () => {
  test('Office adds a boiler and sees when its next check is due', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const site = await createSite()

    const page = await visit(`/sites/${site.id}`)
    await page.getByRole('link', { name: 'Add equipment' }).click()
    await page.getByLabel('Type').fill('Boiler')
    await page.getByLabel('Make').fill('Vaillant')
    await page.getByLabel('Install date').fill('2025-05-20')
    await page.getByLabel('Maintenance Interval (months)').fill('12')
    await page.getByRole('button', { name: 'Save equipment' }).click()

    await page.waitForURL(`**/sites/${site.id}`)
    await page.getByRole('cell', { name: /2026-05-20/ }).waitFor()
  })
})
