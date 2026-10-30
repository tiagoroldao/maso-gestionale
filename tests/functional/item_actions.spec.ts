import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import StockLedger from '#stock/stock_ledger'
import type { ScreenAction } from '#shared/screen_actions'
import { createUser } from '#tests/helpers/users'
import { createItem } from '#tests/helpers/items'
import Supplier from '#models/supplier'
import { it } from '#tests/helpers/i18n'

/** The Item page's header actions (docs/ui.md "Actions"), as `name:rank` */
async function actionsOf(client: ApiClient, itemId: number, role: 'office' | 'admin' = 'office') {
  const page = await client
    .get(`/items/${itemId}`)
    .withInertia()
    .loginAs(await createUser(role))
  page.assertStatus(200)
  return page.inertiaProps.actions as ScreenAction[]
}
const ranked = (actions: ScreenAction[]) => actions.map((action) => `${action.name}:${action.rank}`)

test.group('Item page actions (#242)', () => {
  test('a new Item: a receipt first, an adjustment and editing beside it, archiving and deleting in "⋯"', async ({
    client,
    assert,
  }) => {
    const item = await createItem({ code: 'RAC-12' })

    for (const role of ['office', 'admin'] as const) {
      const actions = await actionsOf(client, item.id, role)
      assert.deepEqual(ranked(actions), [
        'receive:primary',
        'adjust:secondary',
        'edit:secondary',
        'archive:overflow',
        'delete:overflow',
      ])
      const archive = actions.find((action) => action.name === 'archive')!
      assert.equal(archive.href, `/items/${item.id}/archive`)
      assert.equal(archive.confirm, it('ui.items.archiveConfirm', { code: 'RAC-12' }))
      const remove = actions.find((action) => action.name === 'delete')!
      assert.isTrue(remove.destructive)
      assert.equal(remove.kind, 'post')
      assert.equal(remove.method, 'delete')
      assert.equal(remove.href, `/items/${item.id}`)
      assert.equal(remove.confirm, it('ui.items.deleteConfirm'))
    }
  })

  test('an Item in use is archived, never deleted: no Elimina', async ({ client, assert }) => {
    const item = await createItem()
    await StockLedger.receive(item, { quantity: '2', occurredOn: DateTime.now() })

    assert.deepEqual(ranked(await actionsOf(client, item.id)), [
      'receive:primary',
      'adjust:secondary',
      'edit:secondary',
      'archive:overflow',
    ])
  })

  test('an archived Item offers Ripristina, which brings back its page', async ({
    client,
    assert,
  }) => {
    const item = await createItem({ archivedAt: DateTime.now() })

    const actions = await actionsOf(client, item.id)
    assert.deepEqual(ranked(actions), [
      'receive:primary',
      'adjust:secondary',
      'edit:secondary',
      'unarchive:overflow',
      'delete:overflow',
    ])

    const response = await client
      .post(`/items/${item.id}/unarchive`)
      .withCsrfToken()
      .redirects(0)
      .loginAs(await createUser('office'))
    response.assertHeader('location', `/items/${item.id}`)
  })

  test('the page says when available stock is at or below the reorder level', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const item = await createItem({ reorderLevel: '5' })
    await StockLedger.receive(item, { quantity: '3', occurredOn: DateTime.now() })

    const page = await client.get(`/items/${item.id}`).withInertia().loginAs(office)
    assert.equal(page.inertiaProps.reorder, 'low')
  })

  test('the Item and Supplier forms are in edit mode: Save is their only action', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const item = await createItem()
    const supplier = await Supplier.create({
      name: 'Idrotermica Srl',
      vatCountry: 'IT',
      vatNumber: '01234567890',
    })

    for (const [url, label] of [
      ['/items/create', 'ui.items.save'],
      [`/items/${item.id}/edit`, 'ui.items.save'],
      ['/suppliers/create', 'ui.suppliers.create'],
      [`/suppliers/${supplier.id}/edit`, 'ui.suppliers.save'],
    ]) {
      const page = await client.get(url).withInertia().loginAs(office)
      const actions = page.inertiaProps.actions as ScreenAction[]
      assert.deepEqual(
        actions.map((action) => [action.name, action.rank, action.kind, action.label]),
        [['save', 'primary', 'submit', it(label)]],
        url
      )
    }
  })

  test('the Item names the Supplier linked by its invoices, with the id for its link', async ({
    client,
  }) => {
    const supplier = await Supplier.create({
      name: 'Idrotermica Srl',
      vatCountry: 'IT',
      vatNumber: '01234567890',
    })
    const item = await createItem({ supplierId: supplier.id, supplierName: 'Typed by hand' })

    const page = await client
      .get(`/items/${item.id}`)
      .withInertia()
      .loginAs(await createUser('office'))
    page.assertInertiaPropsContains({
      item: { supplierName: 'Idrotermica Srl', supplierId: supplier.id },
    })
  })
})
