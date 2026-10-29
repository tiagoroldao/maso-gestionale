import Big from 'big.js'
import { test } from '@japa/runner'
import type { Assert } from '@japa/assert'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import type Item from '#models/item'
import type Job from '#models/job'
import LabourRate from '#models/labour_rate'
import type User from '#models/user'
import Visit from '#models/visit'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Quotes from '#services/quotes'
import db from '@adonisjs/lucid/services/db'
import StockLedger, { AVAILABLE_SQL } from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

/**
 * The Item's in stock, committed and available, asserted to agree in
 * TypeScript (the Item page) and SQL (the lists, and AVAILABLE_SQL).
 */
async function quantitiesOf(assert: Assert, item: Item) {
  const ts = await StockLedger.quantitiesOf(item)
  const quantities = await StockLedger.quantities([item.id])
  const sql = quantities.get(item.id)
  assert.deepEqual(sql, ts, `quantities of Item ${item.code}`)
  const row = await db
    .from('items')
    .where('id', item.id)
    .select(db.raw(`${AVAILABLE_SQL('items')} AS available`))
    .firstOrFail()
  assert.equal(new Big(row.available).toFixed(3), ts.available, `available of ${item.code}`)
  return ts
}

/**
 * A Job in progress with an open Visit where Anna recorded 3 valves; 10
 * valves in stock, a reorder level of 5.
 */
async function plannedOnVisit() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician', { fullName: 'Anna' })
  const job = await createJob(await createCustomer(), { status: 'in_progress' })
  const start = DateTime.fromISO('2026-10-20T09:00')
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 3 }),
    status: 'in_progress',
  })
  await visit.related('technicians').attach([anna.id])
  const valve = await createItem({ code: 'VAL', unit: 'pz', reorderLevel: '5' })
  await StockLedger.receive(valve, { quantity: '10', occurredOn: start })
  const valves = await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '3' }, anna)
  return { office, anna, job, visit, valve, valves }
}

/**
 * An accepted Quote for 2 boilers and 4 hours on a Job open for work; 3
 * boilers in stock.
 */
async function acceptedQuote() {
  await completeCompany()
  const office = await createUser('office')
  const job = await createJob(await createCustomer(), { status: 'open' })
  const boiler = await createItem({ code: 'CAL', unit: 'pz' })
  await StockLedger.receive(boiler, { quantity: '3', occurredOn: DateTime.now() })
  const rate = await LabourRate.firstOrCreate({ name: 'Posa' }, { hourlyPrice: '40' })
  const standard = await vatCode()
  const quote = await Quotes.create(job, {
    lines: [
      {
        kind: 'item',
        itemId: boiler.id,
        description: 'Caldaia',
        quantity: '2',
        unitPrice: '1500',
        vatCodeId: standard.id,
      },
      {
        kind: 'labour',
        labourRateId: rate.id,
        description: 'Posa',
        quantity: '4',
        unitPrice: '40',
        vatCodeId: standard.id,
      },
    ],
  })
  await Quotes.accept(quote)
  await job.refresh()
  await quote.load('lines')
  return { office, job, boiler, quote }
}

async function setStatus(job: Job, status: Job['status']) {
  await job.merge({ status }).save()
}

function post(client: ApiClient, user: User, url: string) {
  return client.post(url).header('referer', '/').withCsrfToken().loginAs(user).redirects(0)
}

test.group('Committed stock', () => {
  test('a planned Item Charge on a Visit is committed, until its Visit closes', async ({
    assert,
  }) => {
    const { anna, visit, valve } = await plannedOnVisit()

    assert.deepEqual(await quantitiesOf(assert, valve), {
      inStock: '10.000',
      committed: '3.000',
      available: '7.000',
    })

    // Closing makes it done: off stock, no longer committed
    await FieldWork.setStatus(visit, 'done', anna)
    assert.deepEqual(await quantitiesOf(assert, valve), {
      inStock: '7.000',
      committed: '0.000',
      available: '7.000',
    })
  })

  test('a not done Item Charge commits nothing and never leaves stock', async ({ assert }) => {
    const { anna, visit, valve, valves } = await plannedOnVisit()

    await FieldWork.setStatus(visit, 'done', anna, [valves.id])

    assert.deepEqual(await quantitiesOf(assert, valve), {
      inStock: '10.000',
      committed: '0.000',
      available: '10.000',
    })
  })

  test('Item Charges imported onto the Job are committed until Office confirms them used', async ({
    assert,
  }) => {
    const { office, job, boiler, quote } = await acceptedQuote()
    const [boilers] = await Quotes.importLines(
      quote,
      { lineIds: quote.lines.map((line) => line.id), workerName: 'Ditta Rossi' },
      office
    )

    assert.deepEqual(await quantitiesOf(assert, boiler), {
      inStock: '3.000',
      committed: '2.000',
      available: '1.000',
    })

    await Charges.setWorkState(boilers, 'done', office, 'Usato')
    assert.deepEqual(await quantitiesOf(assert, boiler), {
      inStock: '1.000',
      committed: '0.000',
      available: '1.000',
    })
    assert.equal(job.status, 'open')
  })

  test('a closed or cancelled Job commits nothing; reopened, it commits again', async ({
    assert,
  }) => {
    const { job, valve } = await plannedOnVisit()

    for (const status of ['closed', 'cancelled'] as const) {
      await setStatus(job, status)
      assert.deepEqual(await quantitiesOf(assert, valve), {
        inStock: '10.000',
        committed: '0.000',
        available: '10.000',
      })
    }

    for (const status of ['open', 'in_progress'] as const) {
      await setStatus(job, status)
      const { committed } = await quantitiesOf(assert, valve)
      assert.equal(committed, '3.000')
    }
  })

  test('commitments add up across Jobs, Visits and the Job itself', async ({ assert }) => {
    const { anna, visit, valve } = await plannedOnVisit()
    await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '2.5' }, anna)
    const other = await createJob(await createCustomer(), { status: 'open' })
    const onJob = await Charge.create({
      jobId: other.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '6',
      billQuantity: '6',
      unitPrice: '10',
      description: 'Valvola',
    })
    const unrelated = await createItem({ code: 'ZZZ' })

    assert.deepEqual(await quantitiesOf(assert, valve), {
      inStock: '10.000',
      committed: '11.500',
      available: '-1.500',
    })
    assert.deepEqual(await quantitiesOf(assert, unrelated), {
      inStock: '0.000',
      committed: '0.000',
      available: '0.000',
    })
    assert.equal(onJob.visitId, null)
  })

  test('the Items list and the Item page show in stock, committed and available', async ({
    client,
  }) => {
    const { office, valve } = await plannedOnVisit()

    const list = await client.get('/items').withInertia().loginAs(office)
    list.assertInertiaPropsContains({
      items: [{ code: 'VAL', inStock: '10.000', committed: '3.000', available: '7.000' }],
    })

    const page = await client.get(`/items/${valve.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      stock: { inStock: '10.000', committed: '3.000', available: '7.000' },
    })
  })

  test('reorder alerts use what is available', async ({ client, assert }) => {
    const { office, anna, visit, valve } = await plannedOnVisit()
    const toReorder = async () => {
      const response = await client.get('/stock').withInertia().loginAs(office)
      return (response.inertiaProps.toReorder as { code: string; reorder: string }[]).map((row) => [
        row.code,
        row.reorder,
      ])
    }

    // 10 in stock, 3 committed: 7 available, above the reorder level of 5
    assert.deepEqual(await toReorder(), [])

    // 5 available: at the reorder level, though 10 are on the shelf
    await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '2' }, anna)
    assert.deepEqual(await toReorder(), [['VAL', 'low']])

    // Below zero available
    await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '6' }, anna)
    assert.deepEqual(await toReorder(), [['VAL', 'negative']])
  })
})

test.group('Committed stock | warnings', () => {
  test('recording an Item in the field beyond what is available warns, never refuses', async ({
    client,
    assert,
  }) => {
    const { anna, visit, valve } = await plannedOnVisit()

    const enough = await post(client, anna, `/my-visits/${visit.id}/items`).form({
      itemId: String(valve.id),
      quantity: '7',
    })
    enough.assertFlashMessage('success', it('flash.visitItemAdded'))

    const short = await post(client, anna, `/my-visits/${visit.id}/items`).form({
      itemId: String(valve.id),
      quantity: '2',
    })
    short.assertFlashMessage(
      'warning',
      `${it('flash.visitItemAdded')} ${it('flash.belowAvailable', { items: 'VAL (-2 pz)' })}`
    )
    const recorded = await Charge.query().where('visitId', visit.id).orderBy('id')
    assert.deepEqual(
      recorded.map((charge) => charge.quantity),
      ['3.000', '7.000', '2.000']
    )
    const { available } = await quantitiesOf(assert, valve)
    assert.equal(available, '-2.000')
  })

  test('importing Quote lines beyond what is available warns, never refuses', async ({
    client,
    assert,
  }) => {
    const { office, job, boiler, quote } = await acceptedQuote()
    await StockLedger.adjust(boiler, {
      quantity: '-2',
      reason: 'Rotta',
      occurredOn: DateTime.now(),
    })

    const response = await post(client, office, `/quotes/${quote.id}/import`).json({
      lineIds: quote.lines.map((line) => line.id),
      workerName: 'Ditta Rossi',
    })

    response.assertFlashMessage(
      'warning',
      `${it('flash.quoteLinesImported', { count: 2 })} ${it('flash.belowAvailable', { items: 'CAL (-1 pz)' })}`
    )
    assert.lengthOf(await Charge.query().where('jobId', job.id), 2)
  })

  test('importing Quote lines within what is available just succeeds', async ({ client }) => {
    const { office, quote } = await acceptedQuote()

    const response = await post(client, office, `/quotes/${quote.id}/import`).json({
      lineIds: quote.lines.map((line) => line.id),
      workerName: 'Ditta Rossi',
    })

    response.assertFlashMessage('success', it('flash.quoteLinesImported', { count: 2 }))
  })

  test('correcting a planned Item Charge beyond what is available warns, never refuses', async ({
    client,
    assert,
  }) => {
    const { office, valve, valves } = await plannedOnVisit()
    const correct = (quantity: string) =>
      client
        .put(`/charges/${valves.id}/recorded`)
        .form({ itemId: String(valve.id), quantity })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)

    const response = await correct('12')
    response.assertFlashMessage(
      'warning',
      `${it('flash.chargeCorrected')} ${it('flash.belowAvailable', { items: 'VAL (-2 pz)' })}`
    )
    await valves.refresh()
    assert.equal(valves.quantity, '12.000')

    // Still short, but no shorter: nothing new to warn about
    const lower = await correct('11')
    lower.assertFlashMessage('success', it('flash.chargeCorrected'))
  })

  test('marking a not done Item done beyond what is available warns, never refuses', async ({
    client,
    assert,
  }) => {
    const { office, anna, visit, valve, valves } = await plannedOnVisit()
    await FieldWork.setStatus(visit, 'done', anna, [valves.id])
    // Another Job plans 9 of the 10 valves
    const other = await createJob(await createCustomer(), { status: 'open' })
    await Charge.create({
      jobId: other.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '9',
      billQuantity: '9',
      unitPrice: '10',
      description: 'Valvola',
    })

    const response = await post(client, office, `/charges/${valves.id}/done`)

    response.assertFlashMessage(
      'warning',
      `${it('flash.chargeWork.done')} ${it('flash.belowAvailable', { items: 'VAL (-2 pz)' })}`
    )
    await valves.refresh()
    assert.isNotNull(valves.stockMovementId)
    const { available } = await quantitiesOf(assert, valve)
    assert.equal(available, '-2.000')

    // Back to not done gives the valves back: nothing to warn about
    const back = await post(client, office, `/charges/${valves.id}/not-done`)
    back.assertFlashMessage('success', it('flash.chargeWork.not_done'))
  })

  test('marking done a Visit left open on a cancelled Job warns when it leaves an Item short', async ({
    client,
    assert,
  }) => {
    const { office, job, visit, valve, valves } = await plannedOnVisit()
    await job.merge({ status: 'cancelled' }).save()
    // The cancelled Job's 3 valves commit nothing; another Job plans 9
    const other = await createJob(await createCustomer(), { status: 'open' })
    await Charge.create({
      jobId: other.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '9',
      billQuantity: '9',
      unitPrice: '10',
      description: 'Valvola',
    })
    const ready = await StockLedger.quantitiesOf(valve)
    assert.equal(ready.available, '1.000')

    const response = await post(client, office, `/visits/${visit.id}/done`).json({
      reviewed: [valves.id],
      done: [valves.id],
    })

    response.assertFlashMessage(
      'warning',
      `${it('flash.visitMarkedDone')} ${it('flash.belowAvailable', { items: 'VAL (-2 pz)' })}`
    )
    await visit.refresh()
    assert.equal(visit.status, 'done')
    const { inStock, available } = await quantitiesOf(assert, valve)
    assert.deepEqual([inStock, available], ['7.000', '-2.000'])
  })
})
