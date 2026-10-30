import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The Item, Giacenze and Supplier screens on the new UI (#242): docs/ui.md's
 * rules where they depend on the screen size, and their accessibility.
 */
test.group('Item, Stock and Supplier screens in the browser', () => {
  test('the Item on a phone: Registra carico in the bottom bar, "⋯" holds archiving and deleting', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem({ code: 'RAC-12', description: 'Raccordo a T' })

    const page = await visit(`/items/${item.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)

    // "‹" goes back to Articoli, beside "☰"
    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.items.title') }) })
      .waitFor()
    await page.getByRole('button', { name: it('ui.shell.openMenu') }).waitFor()

    const bar = page.getByTestId('primary-action')
    await bar.getByRole('button', { name: it('ui.items.receive') }).waitFor()
    const box = await bar.boundingBox()
    assert.equal(Math.round((box?.y ?? 0) + (box?.height ?? 0)), SCREEN_SIZES.phone.height)

    await page.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(
      items.map((label) => label.trim()),
      [it('ui.items.archive'), it('ui.items.delete')]
    )
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    // Archiving asks first, in the confirmation dialog
    await page.getByRole('menuitem', { name: it('ui.items.archive') }).click()
    const confirm = page.getByRole('alertdialog', { name: it('ui.items.archive') })
    await confirm.getByText(it('ui.items.archiveConfirm', { code: 'RAC-12' })).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'confirmation')
    await confirm.getByRole('button', { name: it('ui.items.archive') }).click()
    await page.waitForURL(/\/items$/)
    await item.refresh()
    assert.isNotNull(item.archivedAt)
  })

  test('the Item on a desktop: secondary, primary, "⋯" under the breadcrumb; dark, with a dialog open', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem({ code: 'RAC-12', description: 'Raccordo a T', unit: 'm' })
    await StockLedger.receive(item, {
      quantity: '4',
      unitCost: '2',
      reference: 'DDT 12',
      occurredOn: DateTime.now(),
    })

    const page = await visit(`/items/${item.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)

    const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: it('ui.items.title') }).waitFor()
    await breadcrumb.getByText('RAC-12').waitFor()

    const header = page.locator('main header')
    const adjust = await header.getByRole('button', { name: it('ui.items.adjust') }).boundingBox()
    const edit = await header.getByRole('link', { name: it('ui.common.edit') }).boundingBox()
    const receive = await header.getByRole('button', { name: it('ui.items.receive') }).boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(adjust!.x, edit!.x)
    assert.isBelow(edit!.x, receive!.x)
    assert.isBelow(receive!.x, more!.x)
    // The movement is in the table
    await page.getByTestId('movements').getByText('DDT 12').waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'dark')
    await header.getByRole('button', { name: it('ui.items.receive') }).click()
    await page.getByRole('dialog', { name: it('ui.items.receiptTitle') }).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'dialog')
  })

  test('Giacenze lists what to reorder, as rows on a phone', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem({ description: 'Flessibile inox', reorderLevel: '5' })
    await StockLedger.receive(item, { quantity: '3', occurredOn: DateTime.now() })

    const page = await visit('/stock')
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page.getByRole('heading', { name: it('ui.stock.title'), level: 1 }).waitFor()
    await page.getByRole('link', { name: 'Flessibile inox' }).click()
    await page.waitForURL(`**/items/${item.id}`)
    await page.goBack()
    await page.getByText(it('ui.stock.low')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page.getByTestId('to-reorder').getByRole('link', { name: item.code }).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'desktop')
  })
})
