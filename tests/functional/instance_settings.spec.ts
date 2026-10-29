import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import InstanceSettings from '#models/instance_settings'
import { createUser } from '#tests/helpers/users'
import SdiConnection from '#services/sdi_connection'
import { FakeOpenapi } from '#tests/helpers/openapi'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const fields = {
  sdiMode: 'manual',
  sdiEnvironment: 'sandbox',
  pollingMinutes: '30',
  publicUrl: 'https://maso.example.it',
}
const SECRET = 'whsec_4567890abcdef'

test.group('Instance settings', (group) => {
  // Saving Openapi mode registers the receiving callback: never live here
  group.each.setup(() => {
    SdiConnection.use(
      new FakeOpenapi().keepsApiConfigurations().registers('01987654322', false).gateway()
    )
    return () => SdiConnection.restore()
  })

  test('the Superuser saves settings; the Openapi token is stored encrypted and never shown', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')

    await client
      .put('/instance')
      .form({
        ...fields,
        sdiMode: 'openapi',
        sdiEnvironment: 'production',
        openapiToken: 'oat_secret_123',
        webhookEnabled: 'true',
        webhookSecret: SECRET,
      })
      .withCsrfToken()
      .loginAs(superuser)

    const settings = await InstanceSettings.findOrFail(1)
    assert.equal(settings.pollingMinutes, 30)
    assert.equal(settings.sdiMode, 'openapi')
    assert.equal(settings.sdiEnvironment, 'production')
    assert.isTrue(settings.webhookEnabled)
    assert.equal(settings.publicUrl, 'https://maso.example.it')
    assert.equal(settings.token, 'oat_secret_123')
    const raw = await db.from('instance_settings').where('id', 1).firstOrFail()
    assert.notInclude(raw.openapi_token, 'oat_secret_123')

    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({
      settings: {
        hasToken: true,
        pollingMinutes: 30,
        webhookUrl: 'https://maso.example.it/sdi/webhook',
      },
    })
    assert.notInclude(JSON.stringify(page.inertiaProps), 'oat_secret')
    assert.notInclude(JSON.stringify(page.inertiaProps), SECRET)

    // A blank key keeps the stored one; clearing removes it
    await client.put('/instance').form(fields).withCsrfToken().loginAs(superuser)
    await settings.refresh()
    assert.equal(settings.token, 'oat_secret_123')
    await client
      .put('/instance')
      .form({ ...fields, clearToken: 'true' })
      .withCsrfToken()
      .loginAs(superuser)
    await settings.refresh()
    assert.isNull(settings.token)
  })

  test('the webhook secret is kept the same way', async ({ client, assert }) => {
    const superuser = await createUser('superuser')

    await client
      .put('/instance')
      .form({ ...fields, webhookSecret: SECRET })
      .withCsrfToken()
      .loginAs(superuser)
    const settings = await InstanceSettings.findOrFail(1)
    assert.equal(settings.secret, SECRET)
    const raw = await db.from('instance_settings').where('id', 1).firstOrFail()
    assert.notInclude(raw.webhook_secret, SECRET)
    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({ settings: { hasWebhookSecret: true } })
    assert.notInclude(JSON.stringify(page.inertiaProps), SECRET)

    await client.put('/instance').form(fields).withCsrfToken().loginAs(superuser)
    await settings.refresh()
    assert.equal(settings.secret, SECRET)
    await client
      .put('/instance')
      .form({ ...fields, clearWebhookSecret: 'true' })
      .withCsrfToken()
      .loginAs(superuser)
    await settings.refresh()
    assert.isNull(settings.secret)
  })

  test('Openapi needs a token, and the webhook a secret and the public URL', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')

    const response = await client
      .put('/instance')
      .form({
        sdiMode: 'openapi',
        sdiEnvironment: 'sandbox',
        pollingMinutes: '30',
        webhookEnabled: 'true',
        webhookSecret: 'short',
      })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    const errors = response.flashMessage('inputErrorsBag')
    assert.properties(errors, ['openapiToken', 'webhookSecret', 'publicUrl'])
    // The errors only: the secret typed never travels back in the cookie
    assert.isUndefined(response.flashMessage('webhookSecret'))
    assert.isNull(await InstanceSettings.find(1))

    // A webhook needs a secret even with none typed
    const noSecret = await client
      .put('/instance')
      .form({ ...fields, webhookEnabled: 'true' })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.properties(noSecret.flashMessage('inputErrorsBag'), ['webhookSecret'])

    // Clearing the stored token while staying on Openapi is refused
    await client
      .put('/instance')
      .form({ ...fields, sdiMode: 'openapi', openapiToken: 'oat_secret_123' })
      .withCsrfToken()
      .loginAs(superuser)
    const clearing = await client
      .put('/instance')
      .form({ ...fields, sdiMode: 'openapi', clearToken: 'true' })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.properties(clearing.flashMessage('inputErrorsBag'), ['openapiToken'])
    const settings = await InstanceSettings.findOrFail(1)
    assert.equal(settings.token, 'oat_secret_123')
  })

  test('a token stored under another APP_KEY reads as missing and is reported', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    // As after a restore with a new key: the stored value no longer decrypts
    await db.table('instance_settings').insert({
      id: 1,
      sdi_mode: 'openapi',
      sdi_environment: 'sandbox',
      openapi_token: 'not-decryptable-under-this-key',
      polling_minutes: 60,
    })

    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({ settings: { hasToken: false, tokenUnreadable: true } })

    // Saving on Openapi asks for it again
    const response = await client
      .put('/instance')
      .form({ ...fields, sdiMode: 'openapi' })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.properties(response.flashMessage('inputErrorsBag'), ['openapiToken'])
  })

  test('the polling interval and the public URL are checked', async ({ client, assert }) => {
    const superuser = await createUser('superuser')

    const response = await client
      .put('/instance')
      .form({ ...fields, pollingMinutes: '1', publicUrl: 'http://maso.example.it' })
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
    // Nor anyone signed out
    for (const request of [
      client.put('/instance').form(fields),
      client
        .put(`/instance/admins/${admin.id}/password`)
        .form({ password: 'nuova-password', passwordConfirmation: 'nuova-password' }),
    ]) {
      const guest = await request.withCsrfToken().redirects(0)
      guest.assertStatus(302)
      guest.assertHeader('location', '/login')
    }
    assert.isNull(await InstanceSettings.find(1))
    await admin.refresh()
    assert.equal(admin.password, before)
  })
})
