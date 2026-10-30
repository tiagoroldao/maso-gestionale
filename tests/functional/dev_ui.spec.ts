import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { createUser } from '#tests/helpers/users'

test.group('Component gallery (/dev/ui)', () => {
  test('opens outside production', async ({ client }) => {
    const office = await createUser('office')

    const response = await client.get('/dev/ui').withInertia().loginAs(office)

    response.assertStatus(200)
    response.assertInertiaComponent('dev/ui')
  })

  test('does not exist in production', async ({ client, cleanup }) => {
    const admin = await createUser('admin')
    // `inProduction` reads NODE_ENV once, at boot: stand in for it
    Object.defineProperty(app, 'inProduction', { get: () => true, configurable: true })
    cleanup(() => {
      delete (app as { inProduction?: boolean }).inProduction
    })

    const response = await client.get('/dev/ui').withInertia().loginAs(admin)

    response.assertStatus(404)
  })

  test('needs a login', async ({ client }) => {
    // Set up, so the redirect is to the login and not to the first-run setup
    await createUser('admin')

    const response = await client.get('/dev/ui').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })
})
