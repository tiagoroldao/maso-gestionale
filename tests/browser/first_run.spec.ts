import { test } from '@japa/runner'

test.group('First run in the browser', () => {
  test('sets up the Instance, then the Admin signs in', async ({ visit }) => {
    const page = await visit('/')
    await page.assertPath('/setup')

    await page.getByLabel('Email').first().fill('installer@example.com')
    await page.getByLabel('Password', { exact: true }).first().fill('installer-secret')
    await page.getByLabel('Confirm password').first().fill('installer-secret')
    await page.getByLabel('Full name').fill('Mario Rossi')
    await page.getByLabel('Email').nth(1).fill('mario@example.com')
    await page.getByLabel('Password', { exact: true }).nth(1).fill('admin-secret')
    await page.getByLabel('Confirm password').nth(1).fill('admin-secret')
    await page.getByRole('button', { name: 'Complete setup' }).click()

    await page.waitForURL('**/login')
    await page.getByLabel('Email').fill('mario@example.com')
    await page.getByLabel('Password').fill('admin-secret')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await page.waitForURL('**/dashboard')
    await page.assertPath('/dashboard')
  })
})
