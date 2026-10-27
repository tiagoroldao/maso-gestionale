import { test } from '@japa/runner'
import { it } from '#tests/helpers/i18n'

test.group('First run in the browser', () => {
  test('sets up the Instance, then the Admin signs in', async ({ visit }) => {
    const page = await visit('/')
    await page.assertPath('/setup')

    await page.getByLabel(it('ui.setup.email')).first().fill('installer@example.com')
    await page.getByLabel(it('ui.setup.password'), { exact: true }).first().fill('installer-secret')
    await page.getByLabel(it('ui.setup.confirmPassword')).first().fill('installer-secret')
    await page.getByLabel(it('ui.setup.fullName')).fill('Mario Rossi')
    await page.getByLabel(it('ui.setup.email')).nth(1).fill('mario@example.com')
    await page.getByLabel(it('ui.setup.password'), { exact: true }).nth(1).fill('admin-secret')
    await page.getByLabel(it('ui.setup.confirmPassword')).nth(1).fill('admin-secret')
    await page.getByRole('button', { name: it('ui.setup.submit') }).click()

    await page.waitForURL('**/login')
    await page.getByLabel(it('ui.auth.email')).fill('mario@example.com')
    await page.getByLabel(it('ui.auth.password')).fill('admin-secret')
    await page.getByRole('button', { name: it('ui.auth.signIn') }).click()

    await page.waitForURL('**/dashboard')
    await page.assertPath('/dashboard')
  })
})
