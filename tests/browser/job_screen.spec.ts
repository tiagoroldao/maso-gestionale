import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The Job page as an Entity screen (#235): docs/ui.md's rules where they
 * depend on the screen size, and its accessibility.
 */
test.group('Job screen in the browser', () => {
  test('on a phone, the primary action is in a bar at the bottom and "⋯" opens the rest', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer())

    const page = await visit(`/jobs/${job.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)

    // "‹" goes back to the canonical parent, beside "☰"
    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.jobs.title') }) })
      .waitFor()
    await page.getByRole('button', { name: it('ui.shell.openMenu') }).waitFor()

    // Nothing to bill yet: the draft stays where Office looks for it, with its reason
    const primary = page.getByRole('button', { name: it('ui.invoices.fromCharges') })
    assert.equal(await primary.getAttribute('aria-disabled'), 'true')
    await page.getByText(it('ui.jobs.nothingToBill')).waitFor()
    const bar = await page.getByTestId('primary-action').boundingBox()
    assert.equal(Math.round((bar?.y ?? 0) + (bar?.height ?? 0)), SCREEN_SIZES.phone.height)
    const header = await page.locator('main header').boundingBox()
    assert.isAbove(bar?.y ?? 0, (header?.y ?? 0) + (header?.height ?? 0))

    // The secondary action stays in the header's row; "⋯" holds the others
    await page.getByRole('link', { name: it('ui.visits.plan') }).waitFor()
    await page.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(
      items.map((item) => item.trim()),
      [
        it('ui.common.edit'),
        it('ui.quotes.new'),
        it('ui.invoices.newAdvance'),
        it('ui.legacyInvoices.new'),
        it('ui.jobs.close'),
        it('ui.jobs.cancel'),
      ]
    )
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('on a desktop, the header reads secondary, primary, "⋯" under a breadcrumb', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer())

    const page = await visit(`/jobs/${job.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)

    const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: it('ui.jobs.title') }).waitFor()
    await breadcrumb.getByText(job.number).waitFor()
    // No "‹" on desktop: the breadcrumb says where the Job sits
    assert.equal(
      await page
        .getByRole('link', { name: it('ui.screen.back', { label: it('ui.jobs.title') }) })
        .count(),
      0
    )

    const header = page.locator('main header')
    const secondary = await header.getByRole('link', { name: it('ui.visits.plan') }).boundingBox()
    const primary = await header
      .getByRole('button', { name: it('ui.invoices.fromCharges') })
      .boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(secondary!.x, primary!.x)
    assert.isBelow(primary!.x, more!.x)

    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('the Job screen has no serious accessibility violations in dark, nor with its menu open', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer(), { description: 'Caldaia a condensazione' })

    const page = await visit(`/jobs/${job.id}`)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], size)
    }
    await page.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    await page.getByRole('menu').waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'menu')
  })
})
