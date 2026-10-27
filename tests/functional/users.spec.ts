import { test } from '@japa/runner'
import User from '#models/user'
import hash from '@adonisjs/core/services/hash'
import { createUser } from '#tests/helpers/users'

test.group('Users', () => {
  test('lists business users, editable only for Office and Technician', async ({ client }) => {
    const admin = await createUser('admin', { fullName: 'Anna Admin' })
    await createUser('superuser')
    const office = await createUser('office', { fullName: 'Olga Office' })

    const response = await client.get('/users').withInertia().loginAs(admin)

    response.assertInertiaComponent('users/index')
    response.assertInertiaPropsContains({
      users: [
        { id: admin.id, role: 'admin', canEdit: false },
        { id: office.id, role: 'office', canEdit: true },
      ],
    })
  })

  test('creates an Office or Technician user', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/users')
      .form({
        fullName: 'Tommaso Tecnico',
        email: 'tommaso@example.com',
        role: 'technician',
        password: 'tecnico-secret',
        passwordConfirmation: 'tecnico-secret',
      })
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    response.assertHeader('location', '/users')
    const created = await User.findByOrFail('email', 'tommaso@example.com')
    assert.equal(created.role, 'technician')
    assert.isTrue(created.isActive)
  })

  test('refuses to create Admin accounts or duplicate emails', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/users')
      .form({
        fullName: 'Someone',
        email: admin.email.toUpperCase(),
        role: 'admin',
        password: 'password',
        passwordConfirmation: 'password',
      })
      .header('referer', '/users/create')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    response.assertHeader('location', '/users/create')
    const errors = response.flashMessage('inputErrorsBag')
    assert.properties(errors, ['email', 'role'])
    assert.lengthOf(await User.all(), 1)
  })

  test('edits a user, keeping the password when none is given', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const technician = await createUser('technician')

    await client
      .put(`/users/${technician.id}`)
      .form({ fullName: 'Renamed', email: technician.email, role: 'office' })
      .withCsrfToken()
      .loginAs(admin)

    await technician.refresh()
    assert.equal(technician.fullName, 'Renamed')
    assert.equal(technician.role, 'office')
    assert.isTrue(await hash.verify(technician.password, 'password'))
  })

  test('changes the password when a new one is given', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const technician = await createUser('technician')

    await client
      .put(`/users/${technician.id}`)
      .form({
        fullName: technician.fullName,
        email: technician.email,
        role: 'technician',
        password: 'new-password',
        passwordConfirmation: 'new-password',
      })
      .withCsrfToken()
      .loginAs(admin)

    await technician.refresh()
    assert.isTrue(await hash.verify(technician.password, 'new-password'))
  })

  test('deactivates and reactivates a user', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const office = await createUser('office')

    await client.post(`/users/${office.id}/deactivate`).withCsrfToken().loginAs(admin)
    await office.refresh()
    assert.isFalse(office.isActive)

    await client.post(`/users/${office.id}/reactivate`).withCsrfToken().loginAs(admin)
    await office.refresh()
    assert.isTrue(office.isActive)
  })

  test('an Admin can not manage other Admins or the Superuser', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const otherAdmin = await createUser('admin')
    const superuser = await createUser('superuser')

    for (const target of [admin, otherAdmin, superuser]) {
      const edit = await client.get(`/users/${target.id}/edit`).withInertia().loginAs(admin)
      edit.assertStatus(403)

      // Refused form submissions redirect back with an error instead of a bare 403
      const deactivate = await client
        .post(`/users/${target.id}/deactivate`)
        .header('referer', '/users')
        .withCsrfToken()
        .loginAs(admin)
        .redirects(0)
      deactivate.assertHeader('location', '/users')
      deactivate.assertFlashMessage('error', 'Access denied')
    }

    for (const target of [admin, otherAdmin, superuser]) {
      await target.refresh()
      assert.isTrue(target.isActive)
    }
  })

  test('Office and Technician users can not manage users', async ({ client, assert }) => {
    for (const role of ['office', 'technician'] as const) {
      const user = await createUser(role)
      const target = await createUser('technician')

      const create = await client
        .post('/users')
        .form({ fullName: 'X', email: 'x@example.com', role: 'office' })
        .header('referer', '/dashboard')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      create.assertFlashMessage('error', 'Access denied')

      const deactivate = await client
        .post(`/users/${target.id}/deactivate`)
        .header('referer', '/dashboard')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      deactivate.assertFlashMessage('error', 'Access denied')

      await target.refresh()
      assert.isTrue(target.isActive)
    }
    assert.isNull(await User.findBy('email', 'x@example.com'))
  })
})
