import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('App shell in the browser', () => {
  test('on a phone, Office opens the menu drawer and goes to another screen', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const office = await createUser('office')
    await browserContext.loginAs(office)

    const page = await visit('/jobs')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: it('ui.shell.openMenu') }).click()

    const drawer = page.getByRole('dialog')
    const menu = drawer.getByRole('navigation', { name: it('ui.shell.mainNav') })
    await menu
      .getByRole('link', { name: it('ui.nav.jobs') })
      .and(page.locator('[aria-current="page"]'))
      .waitFor()
    await drawer.getByRole('button', { name: it('ui.common.logout') }).waitFor()

    await menu.getByRole('link', { name: it('ui.nav.customers') }).click()
    await page.waitForURL('**/customers')
    await drawer.waitFor({ state: 'detached' })
    assert.isFalse(await page.getByRole('dialog').isVisible())
  })

  test('a Technician’s menu has only their Visits', async ({ browserContext, visit, assert }) => {
    const technician = await createUser('technician')
    await browserContext.loginAs(technician)

    const page = await visit('/my-visits')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: it('ui.shell.openMenu') }).click()

    const menu = page.getByRole('dialog').getByRole('navigation', { name: it('ui.shell.mainNav') })
    await menu.waitFor()
    const links = await menu.getByRole('link').allTextContents()
    assert.deepEqual(
      links.map((link) => link.trim()),
      [it('ui.nav.myVisits')]
    )
  })
})
