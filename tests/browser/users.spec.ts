import { test } from '@japa/runner'
import User from '#models/user'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('Managing users in the browser', () => {
  test('the Admin creates a Technician and then deactivates them', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const admin = await createUser('admin')
    await browserContext.loginAs(admin)

    const page = await visit('/users')
    await page.getByRole('link', { name: it('ui.users.new') }).click()
    await page.waitForURL('**/users/create')

    await page.getByLabel(it('ui.users.fullName')).fill('Tommaso Tecnico')
    await page.getByLabel(it('ui.users.email')).fill('tommaso@example.com')
    await page.getByLabel(it('ui.users.role')).selectOption('technician')
    await page.getByLabel(it('ui.users.password'), { exact: true }).fill('tecnico-secret')
    await page.getByLabel(it('ui.users.confirmPassword')).fill('tecnico-secret')
    await page.getByRole('button', { name: it('ui.users.create') }).click()

    await page.waitForURL('**/users')
    const row = page.getByRole('row', { name: /Tommaso Tecnico/ })
    await row.getByRole('button', { name: it('ui.users.deactivate') }).click()
    await row.getByRole('button', { name: it('ui.users.reactivate') }).waitFor()

    const technician = await User.findByOrFail('email', 'tommaso@example.com')
    assert.isFalse(technician.isActive)
  })
})
