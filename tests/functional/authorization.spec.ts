import { test } from '@japa/runner'
import type { Role } from '#models/user'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

/**
 * Expected status per role for one page of each kind of access.
 */
const matrix: { url: string; allowed: Role[] }[] = [
  { url: '/dashboard', allowed: ['admin', 'office', 'technician'] },
  { url: '/users', allowed: ['admin'] },
  { url: '/instance', allowed: ['superuser'] },
]
const roles: Role[] = ['superuser', 'admin', 'office', 'technician']

test.group('Authorization by role', () => {
  for (const { url, allowed } of matrix) {
    for (const role of roles) {
      const expected = allowed.includes(role) ? 200 : 403

      test(`${role} gets ${expected} on ${url}`, async ({ client }) => {
        const user = await createUser(role)
        const response = await client.get(url).withInertia().loginAs(user)
        response.assertStatus(expected)
      })
    }
  }

  test('each role lands on its home page', async ({ client }) => {
    for (const [role, home] of [
      ['superuser', '/instance'],
      ['admin', '/dashboard'],
      ['technician', '/my-visits'],
    ] as const) {
      const user = await createUser(role)

      const fromRoot = await client.get('/').loginAs(user).redirects(0)
      fromRoot.assertHeader('location', home)

      const fromLogin = await client
        .post('/login')
        .form({ email: user.email, password: 'password' })
        .withCsrfToken()
        .redirects(0)
      fromLogin.assertHeader('location', home)
    }
  })
})

test.group('Deactivated users', () => {
  test('can not log in', async ({ client }) => {
    const user = await createUser('technician', { isActive: false })

    const response = await client
      .post('/login')
      .form({ email: user.email, password: 'password' })
      .header('referer', '/login')
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/login')
    response.assertFlashMessage('error', it('errors.E_INVALID_CREDENTIALS'))
  })

  test('are signed out on their next request', async ({ client }) => {
    const user = await createUser('office')
    user.isActive = false
    await user.save()

    const response = await client.get('/dashboard').loginAs(user).redirects(0)

    response.assertHeader('location', '/login')
  })
})
