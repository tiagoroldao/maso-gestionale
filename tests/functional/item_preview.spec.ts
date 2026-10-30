import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createCategory, createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'

/**
 * The preview of an Item opened from a Job's Charges (#236): the Job
 * says which Charges name an Item, and the preview loads it as JSON, for
 * the roles that may open the Item's page.
 */
test.group('Item preview', () => {
  async function jobWithAValve() {
    const job = await createJob(await createCustomer())
    const category = await createCategory({ name: 'Idraulica' })
    const valve = await createItem({
      code: 'VAL-01',
      description: 'Valvola a sfera',
      unit: 'pz',
      categoryId: category.id,
    })
    await StockLedger.receive(valve, { quantity: '5', occurredOn: DateTime.now() })
    await Charge.create({
      jobId: job.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '2',
      billQuantity: '2',
      unitPrice: '7.5',
      description: 'Valvola a sfera',
    })
    await Charge.create({
      jobId: job.id,
      kind: 'other',
      quantity: '1',
      billQuantity: '1',
      unitPrice: '40',
      description: 'Diritto di chiamata',
      vatKind: 'labour',
      unit: 'pz',
    })
    return { job, valve }
  }

  test('{$self}: the Job names the Item of an Item’s Charge, and its preview loads')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { job, valve } = await jobWithAValve()

      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
      const charges = page.inertiaProps.charges as { description: string; itemId: number | null }[]
      assert.deepEqual(
        charges.map((charge) => [charge.description, charge.itemId]),
        [
          ['Valvola a sfera', valve.id],
          ['Diritto di chiamata', null],
        ]
      )

      const preview = await client.get(`/items/${valve.id}/preview`).loginAs(user)
      preview.assertStatus(200)
      const stock = await StockLedger.quantitiesOf(valve)
      assert.deepEqual(preview.body(), {
        item: {
          id: valve.id,
          code: 'VAL-01',
          description: 'Valvola a sfera',
          unit: 'pz',
          category: 'Idraulica',
          inStock: stock.inStock,
          available: stock.available,
        },
      })
      assert.equal(Number(stock.inStock), 5)
    })

  test('{$self} can not load an Item’s preview')
    .with(['technician', 'superuser'] as const)
    .run(async ({ client }, role) => {
      const { valve } = await jobWithAValve()

      const response = await client
        .get(`/items/${valve.id}/preview`)
        .loginAs(await createUser(role))
      response.assertStatus(403)
    })

  test('an unknown Item has no preview', async ({ client }) => {
    const response = await client.get('/items/999999/preview').loginAs(await createUser('office'))
    response.assertStatus(404)
  })
})
