import { test } from '@japa/runner'
import CompanySettings from '#models/company_settings'
import LabourRate from '#models/labour_rate'
import PaymentTerms from '#models/payment_terms'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The settings area's screens on the new UI (#244): each one's header,
 * tabs and actions, and docs/ui.md's rules where they depend on the
 * screen size.
 */
const SCREENS = [
  { path: '/settings/company', title: 'ui.settings.company', save: 'ui.company.save' },
  { path: '/settings/payment-terms', title: 'ui.settings.paymentTerms' },
  { path: '/settings/categories', title: 'ui.settings.categories' },
  { path: '/settings/rates', title: 'ui.settings.rates' },
  { path: '/settings/vat-codes', title: 'ui.settings.vatCodes' },
  { path: '/settings/vat-rules', title: 'ui.settings.vatRules', save: 'ui.vatRules.save' },
  { path: '/settings/invoice-numbering', title: 'ui.settings.invoiceNumbering' },
] as const

test.group('Settings screens in the browser', () => {
  for (const screen of SCREENS) {
    test(`${screen.path}: the header names the page under Impostazioni, its tab marked`, async ({
      browserContext,
      visit,
      assert,
    }) => {
      await browserContext.loginAs(await createUser('admin'))

      const page = await visit(screen.path)
      await page.setViewportSize(SCREEN_SIZES.desktop)

      await page.getByRole('heading', { level: 1, name: it(screen.title) }).waitFor()
      const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
      if (screen.path === '/settings/company') {
        // The area's home: nothing above it
        assert.equal(await breadcrumb.getByRole('link').count(), 0)
      } else {
        await breadcrumb.getByRole('link', { name: it('ui.settings.title') }).waitFor()
      }
      const tabs = page.getByRole('navigation', { name: it('ui.settings.title'), exact: true })
      assert.equal(
        await tabs.getByRole('link', { name: it(screen.title) }).getAttribute('aria-current'),
        'page'
      )

      // Save is the primary action of a screen in edit mode, and the only one
      const header = page.locator('main header')
      if ('save' in screen) {
        await header.getByRole('button', { name: it(screen.save) }).waitFor()
      }
      assert.equal(await header.getByRole('button').count(), 'save' in screen ? 1 : 0)

      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
    })
  }

  test('on a phone, Save is the bar at the bottom and saves the form', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))

    const page = await visit('/settings/company')
    await page.setViewportSize(SCREEN_SIZES.phone)

    const bar = await page.getByTestId('primary-action').boundingBox()
    assert.equal(Math.round((bar?.y ?? 0) + (bar?.height ?? 0)), SCREEN_SIZES.phone.height)
    await page.getByLabel(it('ui.company.name')).fill('Idraulica Maso S.r.l.')
    await page.getByLabel(it('ui.company.vatNumber')).fill('12345678903')
    await page.getByLabel(it('ui.company.taxCode')).fill('12345678903')
    await page.getByLabel(it('ui.address.street'), { exact: true }).fill('Via Roma')
    await page.getByLabel(it('ui.address.postalCode'), { exact: true }).fill('20121')
    await page.getByLabel(it('ui.address.city')).fill('Milano')
    await page.getByLabel(it('ui.address.province'), { exact: true }).fill('MI')
    await page
      .getByTestId('primary-action')
      .getByRole('button', { name: it('ui.company.save') })
      .click()

    await page.getByText(it('flash.companySaved')).waitFor()
    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.name, 'Idraulica Maso S.r.l.')
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('on a phone, "‹" goes back to Impostazioni and a row edited in place keeps its errors', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))

    const page = await visit('/settings/categories')
    await page.setViewportSize(SCREEN_SIZES.phone)

    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.settings.title') }) })
      .waitFor()
    await page.getByRole('button', { name: it('ui.shell.openMenu') }).waitFor()

    // Each new Category from the section's dialog; a refused row edit names its field
    await page.getByRole('button', { name: it('ui.categories.addTitle') }).click()
    await page.getByLabel(it('ui.categories.name'), { exact: true }).fill('Raccorderia')
    await page.getByRole('button', { name: it('ui.categories.add') }).click()
    const name = page.getByLabel(it('ui.categories.nameOf', { name: 'Raccorderia' }))
    await name.fill('')
    await page
      .getByRole('listitem')
      .filter({ has: name })
      .getByRole('button', { name: it('ui.common.save') })
      .click()
    await page
      .getByText(
        it('ui.common.fieldError', {
          field: it('ui.categories.name'),
          message: it('validator.shared.messages.required'),
        }),
        { exact: true }
      )
      .waitFor()

    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('Enter in a company field saves, as Save in the header does', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))

    const page = await visit('/settings/company')
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page.getByLabel(it('ui.company.name')).fill('Idraulica Maso S.r.l.')
    await page.getByLabel(it('ui.company.vatNumber')).fill('12345678903')
    await page.getByLabel(it('ui.company.taxCode')).fill('12345678903')
    await page.getByLabel(it('ui.address.street'), { exact: true }).fill('Via Roma')
    await page.getByLabel(it('ui.address.postalCode'), { exact: true }).fill('20121')
    await page.getByLabel(it('ui.address.city')).fill('Milano')
    await page.getByLabel(it('ui.address.province'), { exact: true }).fill('MI')
    await page.getByLabel(it('ui.address.city')).press('Enter')

    await page.getByText(it('flash.companySaved')).waitFor()
    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.city, 'Milano')
  })

  test('deleting Payment Terms and archiving a rate ask first', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))
    const terms = await PaymentTerms.create({
      name: '90 gg data fattura',
      days: 90,
      endOfMonth: false,
      paymentMethod: 'MP05',
    })
    const rate = await LabourRate.create({ name: 'Apprendista', hourlyPrice: '25' })

    const page = await visit('/settings/payment-terms')
    await page
      .getByRole('listitem')
      .filter({ has: page.getByLabel(it('ui.paymentTerms.nameOf', { name: terms.name })) })
      .getByRole('button', { name: it('ui.common.delete') })
      .click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByText(it('ui.paymentTerms.deleteConfirm', { name: terms.name })).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
    await dialog.getByRole('button', { name: it('ui.common.delete') }).click()
    await page.getByText(it('flash.paymentTermsDeleted', { name: terms.name })).waitFor()
    assert.isNull(await PaymentTerms.find(terms.id))

    await page.goto('/settings/rates')
    await page
      .getByRole('listitem')
      .filter({ has: page.getByLabel(it('ui.rates.nameOf', { name: rate.name })) })
      .getByRole('button', { name: it('ui.rates.archive') })
      .click()
    // Going back leaves the rate as it was
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: it('ui.screen.goBack') })
      .click()
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
    await rate.refresh()
    assert.isNull(rate.archivedAt)
  })
})
