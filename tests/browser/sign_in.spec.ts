import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

test.group('Sign-in in the browser', () => {
  test('on a phone, a user signs in', async ({ visit, assert }) => {
    const office = await createUser('office')

    const page = await visit('/login')
    await page.setViewportSize(SCREEN_SIZES.phone)
    assert.deepEqual(await seriousA11yViolations(page), [])
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    assert.deepEqual(await seriousA11yViolations(page), [], 'dark')

    await page.getByLabel(it('ui.auth.email')).fill(office.email)
    await page.getByLabel(it('ui.auth.password')).fill('password')
    await page.getByRole('button', { name: it('ui.auth.signIn') }).click()

    await page.waitForURL('**/dashboard')
    await page.assertPath('/dashboard')
  })
})
