import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import CompanySettings from '#models/company_settings'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('Company settings in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('the Admin fills in the company details and uploads a logo', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))

    const page = await visit('/settings/company')
    await page.getByLabel(it('ui.company.name')).fill('Idraulica Maso S.r.l.')
    await page.getByLabel(it('ui.company.vatNumber')).fill('12345678903')
    await page.getByLabel(it('ui.company.taxCode')).fill('12345678903')
    await page.getByLabel(it('ui.company.taxRegime')).selectOption('RF19')
    await page.getByLabel(it('ui.address.street'), { exact: true }).fill('Via Roma')
    await page.getByLabel(it('ui.address.postalCode')).fill('20121')
    await page.getByLabel(it('ui.address.city')).fill('Milano')
    await page.getByLabel(it('ui.address.province')).fill('MI')
    await page
      .getByLabel(it('ui.company.uploadLogo'))
      .setInputFiles(app.makePath('tests/fixtures/logo.png'))
    await page.getByRole('button', { name: it('ui.company.save') }).click()

    await page.getByAltText(it('ui.company.currentLogo')).waitFor()
    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.taxRegime, 'RF19')
    assert.isNotNull(settings.logoFile)
  })
})
