import { test } from '@japa/runner'
import User from '#models/user'

const validSetup = {
  superuserEmail: 'installer@example.com',
  superuserPassword: 'installer-secret',
  superuserPasswordConfirmation: 'installer-secret',
  adminFullName: 'Mario Rossi',
  adminEmail: 'mario@example.com',
  adminPassword: 'admin-secret',
  adminPasswordConfirmation: 'admin-secret',
}

test.group('First-run setup', () => {
  test('a fresh Instance sends every page to the setup', async ({ client }) => {
    for (const url of ['/', '/dashboard', '/login']) {
      const response = await client.get(url).redirects(0)
      response.assertHeader('location', '/setup')
    }
  })

  test('creates the Superuser and the first Admin', async ({ client, assert }) => {
    const response = await client.post('/setup').form(validSetup).withCsrfToken().redirects(0)

    response.assertHeader('location', '/login')
    const users = await User.query().orderBy('id')
    assert.deepEqual(
      users.map((user) => [user.role, user.email, user.fullName]),
      [
        ['superuser', 'installer@example.com', null],
        ['admin', 'mario@example.com', 'Mario Rossi'],
      ]
    )
  })

  test('can not be run again once completed', async ({ client, assert }) => {
    await client.post('/setup').form(validSetup).withCsrfToken()

    const page = await client.get('/setup').redirects(0)
    page.assertHeader('location', '/login')

    const second = await client
      .post('/setup')
      .form({ ...validSetup, superuserEmail: 'other@example.com', adminEmail: 'x@example.com' })
      .withCsrfToken()
      .redirects(0)
    second.assertHeader('location', '/login')
    assert.lengthOf(await User.all(), 2)
  })

  test('rejects the same email for the Superuser and the Admin', async ({ client, assert }) => {
    const response = await client
      .post('/setup')
      .form({ ...validSetup, adminEmail: validSetup.superuserEmail })
      .header('referer', '/setup')
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/setup')
    response.assertFlashMessage('inputErrorsBag', {
      adminEmail: ['The adminEmail field and superuserEmail field must be different'],
    })
    assert.lengthOf(await User.all(), 0)
  })
})
