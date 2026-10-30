import { test } from '@japa/runner'
import Item from '#models/item'
import { createUser } from '#tests/helpers/users'
import { createCategory, createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'

test.group('Items in the browser', () => {
  test('the resale price is suggested from the Category, then kept as typed', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const category = await createCategory({ name: 'Raccorderia', markupPercent: '35' })

    const page = await visit('/items/create')
    await page.getByLabel(it('ui.items.code'), { exact: true }).fill('RAC-12')
    await page.getByLabel(it('ui.items.description')).fill('Raccordo a T')
    await page.getByLabel(it('ui.items.category')).selectOption(String(category.id))
    await page.getByLabel(it('ui.items.purchasePrice')).fill('10')
    await assert.equal(await page.getByLabel(it('ui.items.resalePrice')).inputValue(), '13,50')

    await page.getByLabel(it('ui.items.resalePrice')).fill('14,90')
    await page.getByLabel(it('ui.items.purchasePrice')).fill('11')
    assert.equal(await page.getByLabel(it('ui.items.resalePrice')).inputValue(), '14,90')

    await page.getByRole('button', { name: it('ui.items.save') }).click()
    await page.waitForURL(/\/items\/\d+$/)
    const item = await Item.firstOrFail()
    assert.equal(item.resalePrice, '14.9000')
    assert.equal(item.purchasePrice, '11.0000')
  })

  test('deleting an Item asks first', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem({ code: 'RAC-12', description: 'Raccordo a T' })

    const page = await visit(`/items/${item.id}`)
    const more = page.getByRole('button', { name: it('ui.screen.moreActions') })
    const remove = page.getByRole('menuitem', { name: it('ui.items.delete'), exact: true })
    const confirm = page.getByRole('alertdialog', { name: it('ui.items.delete') })
    // Dismissed: the Item stays
    await more.click()
    await remove.click()
    await confirm.getByText(it('ui.items.deleteConfirm')).waitFor()
    await confirm.getByRole('button', { name: it('ui.screen.goBack') }).click()
    await confirm.waitFor({ state: 'hidden' })
    assert.isNotNull(await Item.find(item.id))
    // Confirmed: deleted
    await more.click()
    await remove.click()
    await confirm.getByRole('button', { name: it('ui.items.delete') }).click()
    await page.waitForURL(/\/items$/)
    assert.isNull(await Item.find(item.id))
  })
})
