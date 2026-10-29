import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import StockLedger from '#stock/stock_ledger'
import StockMovement from '#models/stock_movement'
import { createUser } from '#tests/helpers/users'
import { createCategory, createItem } from '#tests/helpers/items'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const today = DateTime.now()

test.group('Stock ledger', () => {
  test('stock is the sum of the movements', async ({ assert }) => {
    const item = await createItem()
    const other = await createItem()

    await StockLedger.receive(item, { quantity: '10', occurredOn: today })
    await StockLedger.adjust(item, { quantity: '-2.5', reason: 'Rotto', occurredOn: today })

    const levels = await StockLedger.levels([item.id, other.id])
    assert.equal(levels.get(item.id), '7.500')
    assert.equal(levels.get(other.id), '0.000')
  })

  test('a receipt with a unit cost sets the purchase price, never the resale price', async ({
    assert,
  }) => {
    const item = await createItem({ purchasePrice: '10', resalePrice: '13.5' })

    await StockLedger.receive(item, { quantity: '5', unitCost: '12.40', occurredOn: today })

    assert.equal(item.purchasePrice, '12.4000')
    assert.equal(item.resalePrice, '13.5000')
    await item.refresh()
    assert.equal(item.purchasePrice, '12.4000')
    // The Item can still be saved after the receipt's transaction
    item.description = 'Still editable'
    await item.save()
  })

  test('a backdated receipt never replaces a newer purchase price', async ({ assert }) => {
    const item = await createItem({ purchasePrice: '10' })

    await StockLedger.receive(item, { quantity: '1', unitCost: '12.40', occurredOn: today })
    await StockLedger.receive(item, {
      quantity: '1',
      unitCost: '10',
      occurredOn: today.minus({ days: 10 }),
    })
    assert.equal(item.purchasePrice, '12.4000')

    // A later receipt on the same date does take over
    await StockLedger.receive(item, { quantity: '1', unitCost: '13', occurredOn: today })
    assert.equal(item.purchasePrice, '13.0000')
  })

  test('joins a caller transaction, rolling back with it', async ({ assert }) => {
    const item = await createItem({ purchasePrice: '10' })

    await db
      .transaction(async (trx) => {
        await StockLedger.receive(item, {
          quantity: '5',
          unitCost: '20',
          occurredOn: today,
          client: trx,
        })
        throw new Error('caller fails')
      })
      .catch(() => {})

    assert.equal(await StockLedger.levelOf(item), '0.000')
    await item.refresh()
    assert.equal(item.purchasePrice, '10.0000')
  })

  test('a receipt without a unit cost keeps the purchase price', async ({ assert }) => {
    const item = await createItem({ purchasePrice: '10' })

    await StockLedger.receive(item, { quantity: '5', occurredOn: today })

    await item.refresh()
    assert.equal(item.purchasePrice, '10.0000')
  })

  test('stock may go negative', async ({ assert }) => {
    const item = await createItem()

    await StockLedger.adjust(item, { quantity: '-3', reason: 'Inventario', occurredOn: today })

    assert.equal(await StockLedger.levelOf(item), '-3.000')
  })

  test('refuses meaningless movements', async ({ assert }) => {
    const item = await createItem()

    await assert.rejects(() => StockLedger.receive(item, { quantity: '-1', occurredOn: today }))
    await assert.rejects(() =>
      StockLedger.adjust(item, { quantity: '0', reason: 'x', occurredOn: today })
    )
    await assert.rejects(() =>
      StockLedger.adjust(item, { quantity: '1', reason: '  ', occurredOn: today })
    )
    assert.lengthOf(await StockMovement.all(), 0)
  })
})

test.group('Stock screens', () => {
  test('Office records a receipt typed the Italian way', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem({ purchasePrice: '10' })

    const response = await client
      .post(`/items/${item.id}/receipts`)
      .form({
        quantity: '2,5',
        unitCost: '11,20',
        occurredOn: today.toISODate()!,
        reference: 'DDT 123',
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', `/items/${item.id}`)
    const movement = await StockMovement.firstOrFail()
    assert.equal(movement.kind, 'receipt')
    assert.equal(movement.quantity, '2.500')
    assert.equal(movement.unitCost, '11.2000')
    assert.equal(movement.reference, 'DDT 123')
    assert.equal(movement.createdBy, office.id)
    await item.refresh()
    assert.equal(item.purchasePrice, '11.2000')
  })

  test('quantities with more than 3 decimals are rejected', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem()

    for (const quantity of ['2,5555', '0,0004']) {
      const response = await client
        .post(`/items/${item.id}/receipts`)
        .form({ quantity, occurredOn: today.toISODate()! })
        .header('referer', `/items/${item.id}`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      assert.properties(response.flashMessage('inputErrorsBag'), ['quantity'])
    }
    assert.lengthOf(await StockMovement.all(), 0)
  })

  test('Technicians can not record movements', async ({ client, assert }) => {
    const technician = await createUser('technician')
    const item = await createItem()

    for (const request of [
      client
        .post(`/items/${item.id}/receipts`)
        .form({ quantity: '1', occurredOn: today.toISODate()! }),
      client
        .post(`/items/${item.id}/adjustments`)
        .form({ quantity: '-1', reason: 'x', occurredOn: today.toISODate()! }),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(technician)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await StockMovement.all(), 0)
  })

  test('an adjustment needs a reason', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem()

    const response = await client
      .post(`/items/${item.id}/adjustments`)
      .form({ quantity: '-1', reason: '', occurredOn: today.toISODate()! })
      .header('referer', `/items/${item.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['reason'])
    assert.lengthOf(await StockMovement.all(), 0)
  })

  test('the Item page shows stock and history, newest first', async ({ client }) => {
    const office = await createUser('office')
    const item = await createItem()
    await StockLedger.receive(item, { quantity: '10', occurredOn: today.minus({ days: 2 }) })
    await StockLedger.adjust(item, { quantity: '-1', reason: 'Rotto', occurredOn: today })

    const response = await client.get(`/items/${item.id}`).withInertia().loginAs(office)

    response.assertInertiaComponent('items/show')
    response.assertInertiaPropsContains({
      stock: { inStock: '9.000', committed: '0.000', available: '9.000' },
      movements: [
        { kind: 'adjustment', quantity: '-1.000', reason: 'Rotto' },
        { kind: 'receipt', quantity: '10.000' },
      ],
    })
  })

  test('lists Items to reorder and prices below the markup', async ({ client, assert }) => {
    const office = await createUser('office')
    const category = await createCategory({ markupPercent: '35' })
    const negative = await createItem({ code: 'NEG' })
    const low = await createItem({ code: 'LOW', reorderLevel: '5' })
    const fine = await createItem({ code: 'OK', reorderLevel: '5' })
    const costly = await createItem({
      code: 'COSTLY',
      categoryId: category.id,
      purchasePrice: '10',
      resalePrice: '13.5',
    })
    await StockLedger.adjust(negative, { quantity: '-1', reason: 'x', occurredOn: today })
    await StockLedger.receive(low, { quantity: '5', occurredOn: today })
    await StockLedger.receive(fine, { quantity: '6', occurredOn: today })
    await StockLedger.receive(costly, { quantity: '1', unitCost: '11', occurredOn: today })

    const archived = await createItem({ code: 'ARCH' })
    await StockLedger.adjust(archived, { quantity: '-1', reason: 'x', occurredOn: today })
    archived.archivedAt = DateTime.now()
    await archived.save()

    const response = await client.get('/stock').withInertia().loginAs(office)

    const codes = (rows: unknown) => (rows as { code: string }[]).map((row) => row.code)
    assert.sameMembers(codes(response.inertiaProps.toReorder), ['NEG', 'LOW'])
    assert.sameMembers(codes(response.inertiaProps.belowMarkup), ['COSTLY'])
  })

  test('an Item with stock history can only be archived, not deleted', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const item = await createItem()
    await StockLedger.receive(item, { quantity: '1', occurredOn: today })

    const response = await client
      .delete(`/items/${item.id}`)
      .header('referer', `/items/${item.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.itemInUse', { code: item.code }))
    await item.refresh()
    assert.isFalse(item.$isDeleted)
  })

  test('Technicians can not see or change stock', async ({ client }) => {
    const technician = await createUser('technician')
    const item = await createItem()

    for (const url of ['/stock', `/items/${item.id}`]) {
      const response = await client.get(url).withInertia().loginAs(technician)
      response.assertStatus(403)
    }
  })
})
