import { test } from '@japa/runner'
import User from '#models/user'
import { createUser } from '#tests/helpers/users'

test.group('Managing users in the browser', () => {
  test('the Admin creates a Technician and then deactivates them', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const admin = await createUser('admin')
    await browserContext.loginAs(admin)

    const page = await visit('/users')
    await page.getByRole('link', { name: 'New user' }).click()
    await page.waitForURL('**/users/create')

    await page.getByLabel('Full name').fill('Tommaso Tecnico')
    await page.getByLabel('Email').fill('tommaso@example.com')
    await page.getByLabel('Role').selectOption('technician')
    await page.getByLabel('Password', { exact: true }).fill('tecnico-secret')
    await page.getByLabel('Confirm password').fill('tecnico-secret')
    await page.getByRole('button', { name: 'Create user' }).click()

    await page.waitForURL('**/users')
    const row = page.getByRole('row', { name: /Tommaso Tecnico/ })
    await row.getByRole('button', { name: 'Deactivate' }).click()
    await row.getByRole('button', { name: 'Reactivate' }).waitFor()

    const technician = await User.findByOrFail('email', 'tommaso@example.com')
    assert.isFalse(technician.isActive)
  })
})
