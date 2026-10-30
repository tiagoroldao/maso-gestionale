import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import StockLedger from '#stock/stock_ledger'
import Item from '#models/item'
import Supplier from '#models/supplier'
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

  test("a new Item is saved from the phone's bottom bar, its edit screen under the Item", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))

    const page = await visit('/items/create')
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.items.title') }) })
      .waitFor()
    await page.getByLabel(it('ui.items.code'), { exact: true }).fill('RAC-12')
    await page.getByLabel(it('ui.items.description')).fill('Raccordo a T')
    await page.getByLabel(it('ui.items.purchasePrice')).fill('10')
    await page.getByLabel(it('ui.items.resalePrice')).fill('14')
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
    await page
      .getByTestId('primary-action')
      .getByRole('button', { name: it('ui.items.save') })
      .click()
    await page.waitForURL(/\/items\/\d+$/)
    const item = await Item.findByOrFail('code', 'RAC-12')

    // Editing sits under the Item: Articoli / RAC-12 / Modifica, Save the only action
    const edit = await visit(`/items/${item.id}/edit`)
    await edit.setViewportSize(SCREEN_SIZES.desktop)
    const breadcrumb = edit.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: 'RAC-12' }).waitFor()
    await breadcrumb.getByText(it('ui.common.edit')).waitFor()
    const buttons = await edit.locator('main header').getByRole('button').allTextContents()
    assert.deepEqual(
      buttons.map((label) => label.trim()),
      [it('ui.items.save')]
    )
    assert.deepEqual(await seriousA11yViolations(edit, { content: true }), [], 'edit')
  })

  test('a Supplier is edited under Fornitori, its VAT number fixed', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const supplier = await Supplier.create({
      name: 'Idrotermica Srl',
      vatCountry: 'IT',
      vatNumber: '01234567890',
    })

    const page = await visit(`/suppliers/${supplier.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.suppliers.title') }) })
      .waitFor()
    await page.getByText('IT01234567890').waitFor()
    assert.equal(await page.getByLabel(it('ui.suppliers.vatNumber')).count(), 0)
    await page.getByLabel(it('ui.suppliers.city')).fill('Trento')
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
    await page
      .getByTestId('primary-action')
      .getByRole('button', { name: it('ui.suppliers.save') })
      .click()
    await page.waitForURL(/\/suppliers$/)
    await supplier.refresh()
    assert.equal(supplier.city, 'Trento')

    const create = await visit('/suppliers/create')
    await create.setViewportSize(SCREEN_SIZES.desktop)
    await create.getByLabel(it('ui.suppliers.vatNumber')).waitFor()
    await create
      .locator('main header')
      .getByRole('button', { name: it('ui.suppliers.create') })
      .waitFor()
    assert.deepEqual(await seriousA11yViolations(create, { content: true }), [], 'new')
  })
})
