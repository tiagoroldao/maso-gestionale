import { test } from '@japa/runner'
import User from '#models/user'

async function createAdmin() {
  await User.create({ email: 'root@example.com', password: 'root-secret', role: 'superuser' })
  return User.create({
    fullName: 'Mario Rossi',
    email: 'mario@example.com',
    password: 'admin-secret',
    role: 'admin',
  })
}

test.group('Session', () => {
  test('unauthenticated requests are redirected to the login page', async ({ client }) => {
    await createAdmin()

    for (const url of ['/', '/dashboard']) {
      const response = await client.get(url).redirects(0)
      response.assertHeader('location', '/login')
    }
  })

  test('logs in with valid credentials', async ({ client }) => {
    await createAdmin()

    const response = await client
      .post('/login')
      .form({ email: 'mario@example.com', password: 'admin-secret' })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/dashboard')
  })

  test('rejects invalid credentials', async ({ client }) => {
    await createAdmin()

    const response = await client
      .post('/login')
      .form({ email: 'mario@example.com', password: 'wrong-password' })
      .header('referer', '/login')
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/login')
  })

  test('shows the dashboard to a logged-in user', async ({ client }) => {
    const admin = await createAdmin()

    const response = await client.get('/dashboard').withInertia().loginAs(admin)

    response.assertStatus(200)
    response.assertInertiaComponent('dashboard')
    response.assertInertiaPropsContains({ user: { email: 'mario@example.com', role: 'admin' } })
  })

  test('logs out', async ({ client }) => {
    const admin = await createAdmin()

    const response = await client.post('/logout').withCsrfToken().loginAs(admin).redirects(0)

    response.assertHeader('location', '/login')
  })
})
