import { test } from '@japa/runner'
import User from '#models/user'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'

test.group('Managing users in the browser', () => {
  test('the Admin creates a Technician, then deactivates and reactivates them, asked first each time', async ({
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
    const row = page.getByRole('listitem', { name: 'Tommaso Tecnico' })
    const dialog = page.getByRole('alertdialog')
    const technician = await User.findByOrFail('email', 'tommaso@example.com')

    // Each asks first, naming the person; going back changes nothing
    for (const [action, question] of [
      ['ui.users.deactivate', 'ui.users.deactivateConfirm'],
      ['ui.users.reactivate', 'ui.users.reactivateConfirm'],
    ] as const) {
      await row.getByRole('button', { name: it(action) }).click()
      await dialog.getByText(it(question, { name: 'Tommaso Tecnico' })).waitFor()
      await dialog.getByRole('button', { name: it('ui.screen.goBack') }).click()
      await dialog.waitFor({ state: 'hidden' })
      await technician.refresh()
      assert.equal(technician.isActive, action === 'ui.users.deactivate')

      await row.getByRole('button', { name: it(action) }).click()
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
      await dialog.getByRole('button', { name: it(action) }).click()
      const next = action === 'ui.users.deactivate' ? 'ui.users.reactivate' : 'ui.users.deactivate'
      await row.getByRole('button', { name: it(next) }).waitFor()
      await technician.refresh()
      assert.equal(technician.isActive, action === 'ui.users.reactivate')
    }
  })
})
