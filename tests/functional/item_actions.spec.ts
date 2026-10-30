import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import StockLedger from '#stock/stock_ledger'
import type { ScreenAction } from '#shared/screen_actions'
import { createUser } from '#tests/helpers/users'
import { createItem } from '#tests/helpers/items'
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
      assert.equal(remove.kind, 'dialog')
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
})
