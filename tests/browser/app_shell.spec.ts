import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

test.group('App shell in the browser', () => {
  test('on a phone, Office opens the menu drawer and goes to another screen', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const office = await createUser('office')
    await browserContext.loginAs(office)

    const page = await visit('/jobs')
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page.getByRole('button', { name: it('ui.shell.openMenu') }).click()

    const drawer = page.getByRole('dialog')
    const menu = drawer.getByRole('navigation', { name: it('ui.shell.mainNav') })
    await menu
      .getByRole('link', { name: it('ui.nav.jobs') })
      .and(page.locator('[aria-current="page"]'))
      .waitFor()
    await drawer.getByRole('button', { name: it('ui.common.logout') }).waitFor()
    assert.deepEqual(await seriousA11yViolations(page), [])

    await menu.getByRole('link', { name: it('ui.nav.customers') }).click()
    await page.waitForURL('**/customers')
    await drawer.waitFor({ state: 'detached' })
    assert.isFalse(await page.getByRole('dialog').isVisible())
  })

  test('a Technician’s menu has only their Visits', async ({ browserContext, visit, assert }) => {
    const technician = await createUser('technician')
    await browserContext.loginAs(technician)

    const page = await visit('/my-visits')
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page.getByRole('button', { name: it('ui.shell.openMenu') }).click()

    const menu = page.getByRole('dialog').getByRole('navigation', { name: it('ui.shell.mainNav') })
    await menu.waitFor()
    const links = await menu.getByRole('link').allTextContents()
    assert.deepEqual(
      links.map((link) => link.trim()),
      [it('ui.nav.myVisits')]
    )
  })

  test('on a tablet, the sidebar is folded to icons, its items still named', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const office = await createUser('office')
    await browserContext.loginAs(office)

    const page = await visit('/jobs')
    await page.setViewportSize(SCREEN_SIZES.tablet)

    assert.equal(await page.getByRole('button', { name: it('ui.shell.openMenu') }).count(), 0)
    const menu = page.getByRole('navigation', { name: it('ui.shell.mainNav') })
    for (const label of ['ui.nav.jobs', 'ui.nav.customers', 'ui.nav.invoices']) {
      const link = menu.getByRole('link', { name: it(label), exact: true })
      await link.waitFor()
      // The name stays for screen readers (sr-only), but isn't shown
      const name = await link.getByText(it(label), { exact: true }).boundingBox()
      assert.isAtMost(name?.width ?? 0, 1, label)
    }
    assert.deepEqual(await seriousA11yViolations(page), [])
  })

  test('on a desktop, the sidebar shows its items’ names and there is no "☰"', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const office = await createUser('office')
    await browserContext.loginAs(office)

    const page = await visit('/jobs')
    await page.setViewportSize(SCREEN_SIZES.desktop)

    assert.equal(await page.getByRole('button', { name: it('ui.shell.openMenu') }).count(), 0)
    const menu = page.getByRole('navigation', { name: it('ui.shell.mainNav') })
    for (const label of ['ui.nav.jobs', 'ui.nav.customers', 'ui.nav.invoices']) {
      const name = await menu.getByText(it(label), { exact: true }).boundingBox()
      assert.isAbove(name?.width ?? 0, 1, label)
    }
    assert.deepEqual(await seriousA11yViolations(page), [])
  })

  test('the shell has no serious accessibility violations in dark', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const office = await createUser('office')
    await browserContext.loginAs(office)

    const page = await visit('/jobs')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      assert.deepEqual(await seriousA11yViolations(page), [], size)
    }
  })

  test('a short screen fills the content area, even inside its form (#270)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))

    // The Supplier form wraps its Entity screen in the form
    const page = await visit('/suppliers/create')
    await page.getByRole('heading', { level: 1 }).waitFor()
    for (const size of ['desktop', 'tablet', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      const main = await page.locator('main').boundingBox()
      const screen = await page
        .locator('main h1')
        .locator('xpath=ancestor::div[contains(@class, "bg-background")][1]')
        .boundingBox()
      const bottom = (box: typeof main) => Math.round((box?.y ?? 0) + (box?.height ?? 0))
      assert.equal(bottom(screen), bottom(main), size)
    }
  })
})
