import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import CompanySettings from '#models/company_settings'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const validSettings = {
  name: 'Idraulica Maso S.r.l.',
  vatNumber: '1234567890 3',
  taxCode: '12345678903',
  taxRegime: 'RF01',
  street: 'Via Roma',
  streetNumber: '12',
  postalCode: '20121',
  city: 'Milano',
  province: 'mi',
  iban: 'it60 x054 2811 1010 0000 0123 456',
  email: 'info@example.com',
  phone: '+39 02 1234567',
}

const logo = app.makePath('tests/fixtures/logo.png')

test.group('Company settings', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('the Admin sees empty settings before the first save', async ({ client }) => {
    const admin = await createUser('admin')

    const response = await client.get('/settings/company').withInertia().loginAs(admin)

    response.assertInertiaComponent('settings/company')
    response.assertInertiaPropsContains({ settings: { name: null, hasLogo: false } })
  })

  test('saves the settings, normalising identifiers', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/company')
      .form(validSettings)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    response.assertHeader('location', '/settings/company')
    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.name, 'Idraulica Maso S.r.l.')
    assert.equal(settings.vatNumber, '12345678903')
    assert.equal(settings.province, 'MI')
    assert.equal(settings.iban, 'IT60X0542811101000000123456')
  })

  test('saving again updates the single row', async ({ client, assert }) => {
    const admin = await createUser('admin')

    for (const name of ['First name', 'Second name']) {
      await client
        .post('/settings/company')
        .form({ ...validSettings, name })
        .withCsrfToken()
        .loginAs(admin)
    }

    const rows = await CompanySettings.all()
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].name, 'Second name')
  })

  test('rejects invalid identifiers and address fields', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/company')
      .form({
        ...validSettings,
        vatNumber: '12345678901',
        taxCode: 'RSSMRA85T10A562X',
        iban: 'IT60X0542811101000000123457',
        postalCode: '2012',
        province: 'Milano',
        taxRegime: 'RF03',
      })
      .header('referer', '/settings/company')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), [
      'vatNumber',
      'taxCode',
      'iban',
      'postalCode',
      'province',
      'taxRegime',
    ])
    assert.isNull(await CompanySettings.find(1))
  })

  test('uploads, serves, replaces and removes the logo', async ({ client, assert }) => {
    const admin = await createUser('admin')

    await client
      .post('/settings/company')
      .fields(validSettings)
      .file('logo', logo)
      .withCsrfToken()
      .loginAs(admin)
    const settings = await CompanySettings.findOrFail(1)
    const first = settings.logoFile!
    assert.match(first, /^company\/logo-\d+\.png$/)

    const served = await client.get('/company/logo').loginAs(admin)
    served.assertStatus(200)
    served.assertHeader('content-type', 'image/png')

    await new Promise((resolve) => setTimeout(resolve, 5))
    await client
      .post('/settings/company')
      .fields(validSettings)
      .file('logo', logo)
      .withCsrfToken()
      .loginAs(admin)
    await settings.refresh()
    assert.notEqual(settings.logoFile, first)
    assert.isFalse(existsSync(storagePath(first)), 'the replaced logo is deleted')

    await client
      .post('/settings/company')
      .fields({ ...validSettings, removeLogo: 'true' })
      .withCsrfToken()
      .loginAs(admin)
    await settings.refresh()
    assert.isNull(settings.logoFile)

    const gone = await client.get('/company/logo').loginAs(admin)
    gone.assertStatus(404)
  })

  test('rejects a logo that is not an image', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/company')
      .fields(validSettings)
      .file('logo', app.makePath('tests/fixtures/not_an_image.txt'))
      .header('referer', '/settings/company')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['logo'])
    assert.isNull(await CompanySettings.find(1))
  })

  test('Office, Technician and Superuser can not edit the settings', async ({ client, assert }) => {
    for (const role of ['office', 'technician', 'superuser'] as const) {
      const user = await createUser(role)

      const page = await client.get('/settings/company').withInertia().loginAs(user)
      page.assertStatus(403)

      const save = await client
        .post('/settings/company')
        .form(validSettings)
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      save.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }

    assert.isNull(await CompanySettings.find(1))
  })
})
