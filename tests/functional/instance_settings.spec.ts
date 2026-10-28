import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import InstanceSettings from '#models/instance_settings'
import { createUser } from '#tests/helpers/users'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const fields = { sdiMode: 'manual', pollingMinutes: '30', publicUrl: 'https://maso.example.it' }

test.group('Instance settings', () => {
  test('the Superuser saves settings; the API key is stored encrypted and never shown', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')

    await client
      .put('/instance')
      .form({ ...fields, invoicetronicApiKey: 'itk_secret_123', webhookEnabled: 'true' })
      .withCsrfToken()
      .loginAs(superuser)

    const settings = await InstanceSettings.findOrFail(1)
    assert.equal(settings.pollingMinutes, 30)
    assert.isTrue(settings.webhookEnabled)
    assert.equal(settings.publicUrl, 'https://maso.example.it')
    assert.equal(settings.apiKey, 'itk_secret_123')
    const raw = await db.from('instance_settings').where('id', 1).firstOrFail()
    assert.notInclude(raw.invoicetronic_api_key, 'itk_secret_123')

    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({ settings: { hasApiKey: true, pollingMinutes: 30 } })
    assert.notInclude(JSON.stringify(page.inertiaProps), 'itk_secret')

    // A blank key keeps the stored one; clearing removes it
    await client.put('/instance').form(fields).withCsrfToken().loginAs(superuser)
    await settings.refresh()
    assert.equal(settings.apiKey, 'itk_secret_123')
    await client
      .put('/instance')
      .form({ ...fields, clearApiKey: 'true' })
      .withCsrfToken()
      .loginAs(superuser)
    await settings.refresh()
    assert.isNull(settings.apiKey)
  })

  test('Invoicetronic mode is not available yet', async ({ client, assert }) => {
    const superuser = await createUser('superuser')

    const response = await client
      .put('/instance')
      .form({ ...fields, sdiMode: 'invoicetronic' })
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.invoicetronicNotAvailable'))
    assert.isNull(await InstanceSettings.find(1))
  })

  test('the polling interval and the public URL are checked', async ({ client, assert }) => {
    const superuser = await createUser('superuser')

    const response = await client
      .put('/instance')
      .form({ sdiMode: 'manual', pollingMinutes: '1', publicUrl: 'http://maso.example.it' })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['pollingMinutes', 'publicUrl'])
    assert.isNull(await InstanceSettings.find(1))
  })

  test('the Superuser sets a new password for an Admin, and only an Admin', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    const admin = await createUser('admin', { fullName: 'Titolare' })
    const office = await createUser('office')

    const page = await client.get('/instance').withInertia().loginAs(superuser)
    // Admins by name and email, nobody else
    assert.deepEqual(page.inertiaProps.admins, [
      { id: admin.id, name: 'Titolare', email: admin.email, active: true },
    ])

    const response = await client
      .put(`/instance/admins/${admin.id}/password`)
      .form({ password: 'nuova-password', passwordConfirmation: 'nuova-password' })
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.adminPasswordSet', { email: admin.email }))
    await admin.refresh()
    assert.isTrue(await hash.verify(admin.password, 'nuova-password'))

    const before = office.password
    const notAdmin = await client
      .put(`/instance/admins/${office.id}/password`)
      .form({ password: 'nuova-password', passwordConfirmation: 'nuova-password' })
      .withCsrfToken()
      .loginAs(superuser)
    notAdmin.assertStatus(404)
    await office.refresh()
    assert.equal(office.password, before)
  })

  test('only the Superuser reaches Instance settings', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const before = admin.password
    for (const role of ['admin', 'office', 'technician'] as const) {
      const user = await createUser(role)
      const page = await client.get('/instance').withInertia().loginAs(user)
      page.assertStatus(403)
      for (const request of [
        client.put('/instance').form(fields),
        client
          .put(`/instance/admins/${admin.id}/password`)
          .form({ password: 'nuova-password', passwordConfirmation: 'nuova-password' }),
      ]) {
        const denied = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.isNull(await InstanceSettings.find(1))
    await admin.refresh()
    assert.equal(admin.password, before)
  })
})
