import { test } from '@japa/runner'
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
    await page.locator('#receipt-quantity').fill('12,5')
    await page.locator('#receipt-unit-cost').fill('1,80')
    await page.getByRole('button', { name: it('ui.items.receive') }).click()

    await page.getByText('12,5 m', { exact: true }).waitFor()
    assert.equal(await StockLedger.levelOf(item), '12.500')
    await item.refresh()
    assert.equal(item.purchasePrice, '1.8000')
  })
})
