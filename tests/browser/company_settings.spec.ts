import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import CompanySettings from '#models/company_settings'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'

test.group('Company settings in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('the Admin fills in the company details and uploads a logo', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))

    const page = await visit('/settings/company')
    await page.getByLabel('Company name (ragione sociale)').fill('Idraulica Maso S.r.l.')
    await page.getByLabel('Partita IVA').fill('12345678903')
    await page.getByLabel('Codice Fiscale').fill('12345678903')
    await page.getByLabel('Tax regime (regime fiscale)').selectOption('RF19')
    await page.getByLabel('Street', { exact: true }).fill('Via Roma')
    await page.getByLabel('CAP').fill('20121')
    await page.getByLabel('Comune').fill('Milano')
    await page.getByLabel('Provincia').fill('MI')
    await page.getByLabel('Upload logo').setInputFiles(app.makePath('tests/fixtures/logo.png'))
    await page.getByRole('button', { name: 'Save company settings' }).click()

    await page.getByAltText('Current logo').waitFor()
    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.taxRegime, 'RF19')
    assert.isNotNull(settings.logoFile)
  })
})
