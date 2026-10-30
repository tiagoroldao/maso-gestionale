import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Customer from '#models/customer'
import InstalledEquipment from '#models/installed_equipment'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'
import { chooseMoreAction } from '#tests/helpers/screen'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The Customer and Site pages and their forms as Entity screens (#239):
 * docs/ui.md's rules where they depend on the screen size, the
 * confirmations, and their accessibility.
 */
test.group('Customer and Site screens in the browser', () => {
  test('a Customer on a phone: the new Job in the bottom bar, "⋯" holds archiving', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ phone: '0461 123456' })
    await createJob(customer)

    const page = await visit(`/customers/${customer.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)

    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.customers.title') }) })
      .waitFor()
    const bar = page.getByTestId('primary-action')
    await bar.getByRole('link', { name: it('ui.jobs.newForCustomer') }).waitFor()
    const box = await bar.boundingBox()
    assert.equal(Math.round((box?.y ?? 0) + (box?.height ?? 0)), SCREEN_SIZES.phone.height)

    // Editing and calling stay in the black header's row
    const header = page.locator('main header')
    await header.getByRole('link', { name: it('ui.common.edit') }).waitFor()
    assert.equal(
      await header.getByRole('link', { name: it('ui.screen.call') }).getAttribute('href'),
      'tel:0461123456'
    )
    await page.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(
      items.map((item) => item.trim()),
      [it('ui.archive.archive')]
    )
    await page.keyboard.press('Escape')

    // The key facts: one open Job, linked to the filtered Jobs list
    const openJobs = page
      .getByLabel(it('ui.screen.keyFacts'))
      .getByRole('link', { name: '1', exact: true })
    assert.equal(await openJobs.getAttribute('href'), `/jobs?customerId=${customer.id}`)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('a Customer on a desktop: secondary, primary, "⋯" under a breadcrumb; archiving asks first', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ phone: '0461 123456' })
    // More Jobs than the page lists, all closed (an open one would refuse archiving): the link to all of them includes them
    for (let index = 0; index < 26; index++) await createJob(customer, { status: 'closed' })

    const page = await visit(`/customers/${customer.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)

    const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: it('ui.customers.title') }).waitFor()
    const header = page.locator('main header')
    const call = await header.getByRole('link', { name: it('ui.screen.call') }).boundingBox()
    const primary = await header
      .getByRole('link', { name: it('ui.jobs.newForCustomer') })
      .boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(call!.x, primary!.x)
    assert.isBelow(primary!.x, more!.x)
    assert.equal(
      await page
        .getByRole('link', { name: it('ui.jobs.allOf', { total: 26 }) })
        .getAttribute('href'),
      `/jobs?customerId=${customer.id}&status=all`
    )
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    // Archiving is confirmed in the dialog, not by the browser
    await chooseMoreAction(page, it('ui.archive.archive'))
    const dialog = page.getByRole('alertdialog')
    await dialog.getByText(it('ui.archive.confirm')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'confirmation')
    await dialog.getByRole('button', { name: it('ui.archive.archive') }).click()
    await header.getByText(it('ui.archive.archivedTag')).waitFor()
    await customer.refresh()
    assert.isNotNull(customer.archivedAt)
  })

  test('a Site in dark: no primary; removing equipment asks its date in a dialog', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const site = await createSite({ accessNotes: 'Chiavi dal portiere' })
    const customer = await createCustomer()
    await site.related('customers').attach([customer.id])
    const boiler = await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia',
      make: 'Vaillant',
      installedOn: DateTime.fromISO('2025-05-20'),
      maintenanceIntervalMonths: 12,
    })

    const page = await visit(`/sites/${site.id}`)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], size)
    }
    assert.equal(await page.getByTestId('primary-action').count(), 0)
    await page.getByRole('link', { name: it('ui.screen.map') }).waitFor()

    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page
      .getByTestId('installed-equipment')
      .getByRole('button', { name: it('ui.equipment.remove') })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(it('ui.equipment.removedOnLabel')).fill('2026-10-01')
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'dialog')
    await dialog.getByRole('button', { name: it('ui.equipment.remove') }).click()
    await page.getByText(it('ui.equipment.removedTitle')).waitFor()
    await boiler.refresh()
    assert.equal(boiler.removedOn?.toISODate(), '2026-10-01')
  })

  test('a new Customer on a phone: Save in the bottom bar submits the form', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))

    const page = await visit('/customers/create')
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page.getByLabel(it('ui.customers.firstName'), { exact: true }).fill('Mario')
    await page.getByLabel(it('ui.customers.lastName')).fill('Rossi')
    await page.getByLabel(it('ui.customers.taxCode')).fill('RSSMRA85T10A562S')
    await page.getByLabel(it('ui.address.street'), { exact: true }).fill('Via Garibaldi')
    await page.getByLabel(it('ui.address.postalCode')).fill('20121')
    await page.getByLabel(it('ui.address.city')).fill('Milano')
    await page.getByLabel(it('ui.address.province')).fill('MI')
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    await page
      .getByTestId('primary-action')
      .getByRole('button', { name: it('ui.customers.save') })
      .click()
    await page.waitForURL(/\/customers\/\d+$/)
    const customer = await Customer.firstOrFail()
    assert.equal(customer.lastName, 'Rossi')
  })
})
