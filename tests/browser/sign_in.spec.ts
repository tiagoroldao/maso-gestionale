import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('Sign-in in the browser', () => {
  test('on a phone, a user signs in', async ({ visit }) => {
    const office = await createUser('office')

    const page = await visit('/login')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByLabel(it('ui.auth.email')).fill(office.email)
    await page.getByLabel(it('ui.auth.password')).fill('password')
    await page.getByRole('button', { name: it('ui.auth.signIn') }).click()

    await page.waitForURL('**/dashboard')
    await page.assertPath('/dashboard')
  })
})
