import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { createSite } from '#tests/helpers/sites'
import { it } from '#tests/helpers/i18n'

test.group('Installed Equipment in the browser', () => {
  test('Office adds a boiler and sees when its next check is due', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const site = await createSite()

    const page = await visit(`/sites/${site.id}`)
    await page.getByRole('link', { name: it('ui.equipment.add') }).click()
    await page.getByLabel(it('ui.equipment.type')).fill('Caldaia')
    await page.getByLabel(it('ui.equipment.make')).fill('Vaillant')
    await page.getByLabel(it('ui.equipment.installedOn')).fill('2025-05-20')
    await page.getByLabel(it('ui.equipment.interval')).fill('12')
    await page.getByRole('button', { name: it('ui.equipment.save') }).click()

    await page.waitForURL(`**/sites/${site.id}`)
    await page.getByRole('cell', { name: /20\/05\/2026/ }).waitFor()
  })
})
