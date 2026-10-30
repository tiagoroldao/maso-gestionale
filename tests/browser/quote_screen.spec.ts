import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Quotes from '#services/quotes'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The Quote as an Entity screen (#240): docs/ui.md's rules where they
 * depend on the screen size, the Item preview from a line, and its
 * accessibility.
 */
test.group('Quote screen in the browser', () => {
  /** A draft with a valve on it, priced so it can be sent */
  async function draftWithAValve() {
    const job = await createJob(await createCustomer())
    const valve = await createItem({ code: 'VAL-01', description: 'Valvola a sfera', unit: 'pz' })
    const vat = await vatCode()
    const quote = await Quotes.create(job, {
      notes: null,
      validityDays: 30,
      lines: [
        {
          kind: 'item',
          itemId: valve.id,
          description: 'Valvola a sfera',
          quantity: '2',
          unitPrice: '7.5',
          vatCodeId: vat.id,
        },
      ],
    })
    return { job, quote, valve }
  }

  test('on a phone, Save is in the bar at the bottom and "⋯" holds the answer', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { job, quote } = await draftWithAValve()

    const page = await visit(`/quotes/${quote.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)

    // "‹" goes back to the Job, the Quote's canonical parent
    await page.getByRole('link', { name: it('ui.screen.back', { label: job.number }) }).waitFor()

    const bar = page.getByTestId('primary-action')
    await bar.getByRole('button', { name: it('ui.quotes.save') }).waitFor()
    const box = await bar.boundingBox()
    assert.equal(Math.round((box?.y ?? 0) + (box?.height ?? 0)), SCREEN_SIZES.phone.height)

    const header = page.locator('main header')
    await header.getByRole('button', { name: it('ui.quotes.send') }).waitFor()
    const pdf = header.getByRole('link', { name: it('ui.quotes.pdf') })
    assert.match((await pdf.getAttribute('href'))!, /^\/quotes\/\d+\/pdf$/)
    assert.equal(await pdf.getAttribute('target'), '_blank')
    await header.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(
      items.map((item) => item.trim()),
      [it('ui.quotes.accept'), it('ui.quotes.decline')]
    )
    await page.keyboard.press('Escape')

    // The line's fields stay editable, its amount worked out as you type
    await page.getByLabel(it('ui.quotes.quantityOf', { position: 1 })).fill('3')
    await page.getByTestId('quote-lines').getByText('22,50 €', { exact: true }).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('on a desktop, the header reads secondary, primary, "⋯" under the Job in the breadcrumb', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { job, quote } = await draftWithAValve()

    const page = await visit(`/quotes/${quote.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)

    const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: it('ui.jobs.title') }).waitFor()
    await breadcrumb.getByRole('link', { name: job.number }).waitFor()
    await breadcrumb.getByText(`${job.number}-1`).waitFor()

    const header = page.locator('main header')
    const send = await header.getByRole('button', { name: it('ui.quotes.send') }).boundingBox()
    const save = await header.getByRole('button', { name: it('ui.quotes.save') }).boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(send!.x, save!.x)
    assert.isBelow(save!.x, more!.x)

    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test("an Item on a line opens its preview over the Quote, which keeps the line's edits", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { quote, valve } = await draftWithAValve()
    // Two used before any was received: short, so tagged as on the Item's page
    await StockLedger.adjust(valve, { quantity: '-2', reason: 'Rotte', occurredOn: DateTime.now() })

    const page = await visit(`/quotes/${quote.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page.getByLabel(it('ui.quotes.quantityOf', { position: 1 })).fill('4')
    await page.getByRole('button', { name: it('ui.quotes.previewItemOf', { position: 1 }) }).click()

    const preview = page.getByRole('dialog', { name: 'Valvola a sfera' })
    await preview.getByText('VAL-01').waitFor()
    const openPage = preview.getByRole('link', { name: it('ui.screen.preview.openPage') })
    assert.equal(await openPage.getAttribute('href'), `/items/${valve.id}`)
    await preview.getByText(it('ui.items.negativeStock')).waitFor()
    await preview.getByText(it('ui.items.negativeAvailable')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'detached' })
    assert.equal(
      await page.getByLabel(it('ui.quotes.quantityOf', { position: 1 })).inputValue(),
      '4'
    )
  })

  test('a sent Quote has no serious accessibility violations in dark, its answer the primary', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { quote } = await draftWithAValve()
    await Quotes.send(quote)

    const page = await visit(`/quotes/${quote.id}`)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      await page
        .getByTestId('primary-action')
        .getByRole('button', { name: it('ui.quotes.accept') })
        .waitFor()
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], size)
    }
    await page.getByRole('button', { name: it('ui.quotes.accept') }).click()
    await page.getByRole('alertdialog').waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'confirmation')
  })

  test('Enter in a line saves the Quote', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const { quote } = await draftWithAValve()

    const page = await visit(`/quotes/${quote.id}`)
    const quantity = page.getByLabel(it('ui.quotes.quantityOf', { position: 1 }))
    await quantity.fill('5')
    await page.getByText(it('ui.quotes.unsaved')).waitFor()
    await quantity.press('Enter')
    await page.getByText(it('ui.quotes.unsaved')).waitFor({ state: 'detached' })

    await quote.load('lines')
    assert.equal(Number(quote.lines[0].quantity), 5)
  })

  test("on a tablet, a line's fields keep one row under their heads", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { quote } = await draftWithAValve()

    const page = await visit(`/quotes/${quote.id}`)
    await page.setViewportSize(SCREEN_SIZES.tablet)
    const box = (label: string) => page.getByLabel(label).boundingBox()
    const description = await box(it('ui.quotes.descriptionOf', { position: 1 }))
    const vat = await box(it('ui.quotes.vatCodeOf', { position: 1 }))
    const remove = await page
      .getByRole('button', { name: it('ui.quotes.removeLine') })
      .boundingBox()

    // The VAT on the description's line, the line's buttons above it, room to type
    assert.equal(Math.round(vat!.y), Math.round(description!.y))
    assert.isBelow(remove!.y + remove!.height, description!.y + 1)
    assert.isAtLeast(description!.width, 160)
  })
})
