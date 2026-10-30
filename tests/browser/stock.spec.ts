import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'

test.group('Stock in the browser', () => {
  test('Office records goods received and sees the new stock', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem({ unit: 'm' })

    const page = await visit(`/items/${item.id}`)
    await page.getByRole('button', { name: it('ui.items.receive') }).click()
    const dialog = page.getByRole('dialog', { name: it('ui.items.receiptTitle') })
    await dialog.locator('#receipt-quantity').fill('12,5')
    await dialog.locator('#receipt-unit-cost').fill('1,80')
    await dialog.getByRole('button', { name: it('ui.items.receive') }).click()

    // In stock, and available alike: nothing is committed
    await page.getByText('12,5 m', { exact: true }).first().waitFor()
    assert.equal(await StockLedger.levelOf(item), '12.500')
    await item.refresh()
    assert.equal(item.purchasePrice, '1.8000')
  })

  test('the negative-stock tag follows the stock after a movement', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem()
    await StockLedger.receive(item, { quantity: '2', occurredOn: DateTime.now() })

    const page = await visit(`/items/${item.id}`)
    await page.getByRole('button', { name: it('ui.items.adjust') }).click()
    const dialog = page.getByRole('dialog', { name: it('ui.items.adjustmentTitle') })
    await dialog.locator('#adjustment-quantity').fill('-5')
    await dialog.locator('#adjustment-reason').fill('Inventario')
    await dialog.getByRole('button', { name: it('ui.items.adjust') }).click()

    await page.getByText(it('ui.items.negativeStock')).waitFor()
  })
})
