import { test } from '@japa/runner'
import Invoice from '#models/invoice'
import Invoices from '#services/invoices'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { chooseMoreAction } from '#tests/helpers/screen'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The Invoice as an Entity screen (#241): docs/ui.md's rules where they
 * depend on the screen size, the Item preview from a line, the
 * confirmations, and its accessibility.
 */
test.group('Invoice screen in the browser', (group) => {
  group.each.setup(async () => {
    await completeCompany()
  })

  /** A direct sale of a valve */
  async function draftWithAValve() {
    const valve = await createItem({ code: 'VAL-01', description: 'Valvola a sfera', unit: 'pz' })
    const invoice = await Invoices.create(await createCustomer({ name: 'Bar Centrale' }))
    const standard = await vatCode()
    await Invoices.save(invoice, {
      lines: [
        {
          itemId: valve.id,
          description: 'Valvola a sfera',
          quantity: '2',
          unitPrice: '7.5',
          vatCodeId: standard.id,
        },
      ],
    })
    return { invoice, valve }
  }

  test('on a phone, finalising is in the bar at the bottom, Save in the header, deleting in "⋯"', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.invoices.title') }) })
      .waitFor()

    const bar = page.getByTestId('primary-action')
    await bar.getByRole('button', { name: it('ui.invoices.finalise') }).waitFor()
    const box = await bar.boundingBox()
    assert.equal(Math.round((box?.y ?? 0) + (box?.height ?? 0)), SCREEN_SIZES.phone.height)

    const header = page.locator('main header')
    await header.getByRole('button', { name: it('ui.invoices.save') }).waitFor()
    await header.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(
      items.map((item) => item.trim()),
      [it('ui.invoices.delete')]
    )
    await page.keyboard.press('Escape')

    // Unsaved edits hold finalising back, with the reason beside it
    await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).fill('3')
    await page.getByTestId('invoice-total').getByText('27,45 €').waitFor()
    await bar.getByText(it('ui.invoices.saveFirst')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('on a desktop, the header reads Save, finalise, "⋯", and Enter in a line saves', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: it('ui.invoices.title') }).waitFor()

    const header = page.locator('main header')
    const save = await header.getByRole('button', { name: it('ui.invoices.save') }).boundingBox()
    const finalise = await header
      .getByRole('button', { name: it('ui.invoices.finalise') })
      .boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(save!.x, finalise!.x)
    assert.isBelow(finalise!.x, more!.x)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    const quantity = page.getByLabel(it('ui.invoices.quantityOf', { position: 1 }))
    await quantity.fill('5')
    await page.getByText(it('ui.invoices.unsaved')).waitFor()
    await quantity.press('Enter')
    await page.getByText(it('flash.invoiceSaved')).waitFor()
    await invoice.load('lines')
    assert.equal(Number(invoice.lines[0].quantity), 5)
  })

  test("an Item on a line opens its preview over the Invoice, which keeps the line's edits", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice, valve } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).fill('4')
    await page
      .getByRole('button', { name: it('ui.invoices.previewItemOf', { position: 1 }) })
      .click()
    const preview = page.getByRole('dialog', { name: 'Valvola a sfera' })
    await preview.getByText('VAL-01').waitFor()
    const openPage = preview.getByRole('link', { name: it('ui.screen.preview.openPage') })
    assert.equal(await openPage.getAttribute('href'), `/items/${valve.id}`)

    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'detached' })
    assert.equal(
      await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).inputValue(),
      '4'
    )
  })

  test("on a tablet, a line's fields keep one row under their heads", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.tablet)
    const box = (label: string) => page.getByLabel(label).boundingBox()
    const description = await box(it('ui.invoices.descriptionOf', { position: 1 }))
    const vat = await box(it('ui.invoices.vatCodeOf', { position: 1 }))
    assert.equal(Math.round(vat!.y), Math.round(description!.y))
    assert.isAtLeast(description!.width, 128)
  })

  test('deleting a draft asks first, in the confirmation dialog', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await chooseMoreAction(page, it('ui.invoices.delete'))
    const confirm = page.getByRole('alertdialog')
    await confirm.getByText(it('ui.invoices.deleteConfirm')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'confirmation')
    await confirm.getByRole('button', { name: it('ui.invoices.delete') }).click()
    await page.waitForURL(/\/invoices$/)
    assert.isNull(await Invoice.find(invoice.id))
  })

  test('an issued Invoice reads as text, its PDF opening in a new tab, in dark too', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()
    await Invoices.finalise(invoice)

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      await page
        .getByTestId('primary-action')
        .getByRole('button', { name: it('ui.invoices.prepareSubmission') })
        .waitFor()
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], size)
    }
    const pdf = page.locator('main header').getByRole('link', { name: it('ui.invoices.pdf') })
    assert.equal(await pdf.getAttribute('href'), `/invoices/${invoice.id}/pdf`)
    assert.equal(await pdf.getAttribute('target'), '_blank')
    assert.equal(await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).count(), 0)
    await page.getByText('Valvola a sfera').waitFor()
  })
})
