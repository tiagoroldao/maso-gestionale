import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import Visit from '#models/visit'
import type Job from '#models/job'
import type User from '#models/user'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Quotes from '#services/quotes'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * A Job with a Quote of a boiler, labour, the call-out and a text line,
 * and an open Visit with Anna on it.
 */
async function quotedJob({ accept = true } = {}) {
  const office = await createUser('office')
  const anna = await createUser('technician')
  const job = await createJob(await createCustomer(), { workCategory: 'maintenance' })
  const item = await createItem({ unit: 'pz', resalePrice: '1800' })
  const rate =
    (await LabourRate.findBy('name', 'Idraulico')) ??
    (await LabourRate.create({ name: 'Idraulico', hourlyPrice: '45' }))
  const standard = await vatCode()
  await Quotes.save(job, {
    lines: [
      {
        kind: 'item',
        itemId: item.id,
        description: 'Caldaia a condensazione',
        quantity: '1',
        unitPrice: '1500',
        vatCodeId: standard.id,
      },
      {
        kind: 'labour',
        labourRateId: rate.id,
        description: 'Posa in opera',
        quantity: '6',
        unitPrice: '40',
        vatCodeId: standard.id,
      },
      {
        kind: 'call_out',
        description: 'Diritto di chiamata',
        quantity: '1',
        unitPrice: '35',
        vatCodeId: standard.id,
      },
      { kind: 'text', description: 'Smaltimento incluso' },
    ],
  })
  if (accept) await Quotes.accept(job)
  await job.refresh()
  const start = DateTime.now().plus({ days: 1 })
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 4 }),
    status: 'planned',
  })
  await visit.related('technicians').attach([anna.id])
  const quote = await job.related('quote').query().preload('lines').firstOrFail()
  const [itemLine, labourLine, callOutLine, textLine] = quote.lines.sort(
    (a, b) => a.position - b.position
  )
  return { office, anna, job, item, rate, visit, itemLine, labourLine, callOutLine, textLine }
}

const chargesOf = (job: Job) => Charge.query().where('jobId', job.id).preload('item').orderBy('id')

function importing(client: any, job: Job, user: User, body: Record<string, unknown>) {
  return client
    .post(`/jobs/${job.id}/quote/import`)
    .json(body)
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

test.group('Importing Quote lines as Charges', () => {
  test('all lines onto the Job: an Item, hours and the call-out; text is skipped', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate, itemLine, labourLine, callOutLine, textLine } =
      await quotedJob()

    const response = await importing(client, job, office, {
      lineIds: [itemLine.id, labourLine.id, callOutLine.id, textLine.id],
      workerName: 'Ditta Rossi',
    })

    response.assertHeader('location', `/jobs/${job.id}`)
    response.assertFlashMessage('success', it('flash.quoteLinesImported', { count: 3 }))
    const charges = await chargesOf(job)
    assert.deepEqual(
      charges.map((charge) => [
        charge.kind,
        charge.visitId,
        charge.quoteLineId,
        charge.description,
        charge.quantity,
        charge.billQuantity,
        charge.unitPrice,
      ]),
      [
        ['item', null, itemLine.id, 'Caldaia a condensazione', '1.000', '1.000', '1500.0000'],
        ['labour', null, labourLine.id, 'Posa in opera', '6.000', '6.000', '40.0000'],
        ['other', null, callOutLine.id, 'Diritto di chiamata', '1.000', '1.000', '35.0000'],
      ]
    )
    const [boiler, hours, callOut] = charges
    // The Quote's price, not the Item's or the rate's current one
    assert.equal(boiler.itemId, item.id)
    assert.equal(boiler.billUnit, 'pz')
    assert.equal(boiler.lineKind, 'material')
    assert.equal(hours.labourRateId, rate.id)
    assert.equal(hours.workerName, 'Ditta Rossi')
    assert.isNull(hours.userId)
    assert.equal(callOut.vatKind, 'labour')
    // No stock moves for Items on the Job itself
    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 0)

    // Each has its "recorded" event, naming the Quote line it came from
    const events = await ChargeEvent.query()
      .whereIn(
        'chargeId',
        charges.map((charge) => charge.id)
      )
      .orderBy('id')
    assert.deepEqual(
      events.map((event) => [event.kind, event.userId, event.changes]),
      [1, 2, 3].map((position) => [
        'recorded',
        office.id,
        { before: {}, after: { quoteLine: String(position) } },
      ])
    )
  })

  test('selected lines onto an open Visit: hours for a Technician on it, stock at close', async ({
    client,
    assert,
  }) => {
    const { office, anna, job, item, visit, itemLine, labourLine } = await quotedJob()

    await importing(client, job, office, {
      lineIds: [itemLine.id, labourLine.id],
      visitId: visit.id,
      technicianId: anna.id,
    })

    const charges = await chargesOf(job)
    assert.deepEqual(
      charges.map((charge) => [charge.kind, charge.visitId, charge.userId, charge.workerName]),
      [
        ['item', visit.id, null, null],
        ['labour', visit.id, anna.id, null],
      ]
    )
    assert.isNull(charges[0].stockMovementId)

    // Closing the Visit takes the imported Item off stock, like any other
    await FieldWork.setStatus(visit, 'done', anna)
    const [movement] = await StockMovement.query().where('itemId', item.id)
    assert.equal(movement.quantity, '-1.000')
    await charges[0].refresh()
    assert.equal(charges[0].stockMovementId, movement.id)
  })

  test('importing a line again gives another Charge, and the Quote page counts them', async ({
    client,
    assert,
  }) => {
    const { office, job, callOutLine, itemLine } = await quotedJob()

    await importing(client, job, office, { lineIds: [callOutLine.id] })
    await importing(client, job, office, { lineIds: [callOutLine.id] })

    assert.lengthOf(await Charge.query().where('quoteLineId', callOutLine.id), 2)
    const page = await client.get(`/jobs/${job.id}/quote`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ importable: true })
    const lines = page.inertiaProps.quote.lines as { id: number; imported: number }[]
    assert.equal(lines.find((line) => line.id === callOutLine.id)!.imported, 2)
    assert.equal(lines.find((line) => line.id === itemLine.id)!.imported, 0)
  })

  test('the call-out goes on the Job even when a Visit is chosen', async ({ client, assert }) => {
    const { office, job, visit, callOutLine } = await quotedJob()

    await importing(client, job, office, { lineIds: [callOutLine.id], visitId: visit.id })

    const [charge] = await chargesOf(job)
    assert.equal(charge.kind, 'other')
    assert.isNull(charge.visitId)
  })

  test('imported hours need a worker who fits: on the Visit, or active on the Job', async ({
    client,
    assert,
  }) => {
    const { office, job, visit, labourLine } = await quotedJob()
    const other = await createUser('technician')
    const inactive = await createUser('technician', { isActive: false })

    for (const body of [
      { lineIds: [labourLine.id] },
      { lineIds: [labourLine.id], workerName: '  ' },
      { lineIds: [labourLine.id], visitId: visit.id, technicianId: other.id },
      { lineIds: [labourLine.id], technicianId: inactive.id },
      { lineIds: [labourLine.id], technicianId: office.id },
    ]) {
      const refused = await importing(client, job, office, body)
      refused.assertFlashMessage('error', it('flash.quoteImportRefused.worker'))
    }
    assert.lengthOf(await chargesOf(job), 0)

    // On the Job itself, any active Technician
    await importing(client, job, office, { lineIds: [labourLine.id], technicianId: other.id })
    const [charge] = await chargesOf(job)
    assert.equal(charge.userId, other.id)
  })

  test('refused onto a closed Visit, or a Visit of another Job', async ({ client, assert }) => {
    const { office, anna, job, visit, itemLine } = await quotedJob()
    const elsewhere = await quotedJob()
    await FieldWork.setStatus(visit, 'done', anna)

    for (const visitId of [visit.id, elsewhere.visit.id]) {
      const refused = await importing(client, job, office, { lineIds: [itemLine.id], visitId })
      refused.assertHeader('location', `/jobs/${job.id}/quote`)
      refused.assertFlashMessage('error', it('flash.quoteImportRefused.done'))
    }
    assert.lengthOf(await chargesOf(job), 0)
    assert.lengthOf(await chargesOf(elsewhere.job), 0)
  })

  test('refused on a cancelled Job and from a Quote not accepted', async ({ client, assert }) => {
    const draft = await quotedJob({ accept: false })
    const refused = await importing(client, draft.job, draft.office, {
      lineIds: [draft.itemLine.id],
    })
    refused.assertFlashMessage('error', it('flash.quoteImportRefused.notAccepted'))
    const draftPage = await client
      .get(`/jobs/${draft.job.id}/quote`)
      .withInertia()
      .loginAs(draft.office)
    draftPage.assertInertiaPropsContains({ importable: false })

    const cancelled = await quotedJob()
    await client.post(`/jobs/${cancelled.job.id}/cancel`).withCsrfToken().loginAs(cancelled.office)
    const onCancelled = await importing(client, cancelled.job, cancelled.office, {
      lineIds: [cancelled.itemLine.id],
    })
    onCancelled.assertFlashMessage('error', it('flash.quoteImportRefused.cancelled'))
    const cancelledPage = await client
      .get(`/jobs/${cancelled.job.id}/quote`)
      .withInertia()
      .loginAs(cancelled.office)
    cancelledPage.assertInertiaPropsContains({ importable: false })

    assert.lengthOf(await chargesOf(draft.job), 0)
    assert.lengthOf(await chargesOf(cancelled.job), 0)
  })

  test('only lines of this Quote with something to charge are imported', async ({
    client,
    assert,
  }) => {
    const { office, job, textLine } = await quotedJob()
    const other = await quotedJob()

    for (const lineIds of [[textLine.id], [other.itemLine.id]]) {
      const refused = await importing(client, job, office, { lineIds })
      refused.assertFlashMessage('error', it('flash.quoteImportRefused.noLines'))
    }
    const empty = await importing(client, job, office, { lineIds: [] })
    assert.properties(empty.flashMessage('inputErrorsBag'), ['lineIds'])
    assert.lengthOf(await chargesOf(job), 0)
    assert.lengthOf(await chargesOf(other.job), 0)
  })

  test('an imported Charge keeps the Quote words when corrected, until repriced', async ({
    client,
    assert,
  }) => {
    const { office, job, rate, labourLine } = await quotedJob()
    await importing(client, job, office, { lineIds: [labourLine.id], workerName: 'Ditta Rossi' })
    const [charge] = await chargesOf(job)

    await Charges.correct(
      charge,
      { quantity: '8', labourRateId: rate.id, workerName: 'Ditta Rossi' },
      office,
      'Correzione'
    )
    await charge.refresh()
    assert.deepEqual(
      [charge.billQuantity, charge.unitPrice, charge.description],
      ['8.000', '40.0000', 'Posa in opera']
    )

    const senior = await LabourRate.create({ name: 'Capo cantiere', hourlyPrice: '60' })
    await Charges.correct(
      charge,
      { quantity: '8', labourRateId: senior.id, workerName: 'Ditta Rossi' },
      office,
      'Correzione'
    )
    await charge.refresh()
    // Repriced: no longer as quoted, and billed at the Job's default VAT
    assert.deepEqual(
      [charge.unitPrice, charge.description, charge.vatCodeId],
      ['60.0000', 'Capo cantiere – Ditta Rossi', null]
    )

    // Corrected again: it follows what was recorded like any Charge
    await Charges.correct(
      charge,
      { quantity: '7', labourRateId: senior.id, workerName: 'Ditta Bianchi' },
      office,
      'Correzione'
    )
    await charge.refresh()
    assert.deepEqual(
      [charge.billQuantity, charge.unitPrice, charge.description],
      ['7.000', '60.0000', 'Capo cantiere – Ditta Bianchi']
    )
  })

  test('lines of nothing are skipped; a long description is kept whole', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer())
    const standard = await vatCode()
    const long = 'Fornitura e posa '.repeat(50).trim()
    await Quotes.save(job, {
      lines: [
        {
          kind: 'call_out',
          description: 'Sopralluogo gratuito',
          quantity: '0',
          unitPrice: '35',
          vatCodeId: standard.id,
        },
        {
          kind: 'call_out',
          description: long,
          quantity: '1',
          unitPrice: '35',
          vatCodeId: standard.id,
        },
      ],
    })
    await Quotes.accept(job)
    const quote = await job.related('quote').query().preload('lines').firstOrFail()
    const [zero, priced] = quote.lines.sort((a, b) => a.position - b.position)

    const refused = await importing(client, job, office, { lineIds: [zero.id] })
    refused.assertFlashMessage('error', it('flash.quoteImportRefused.noLines'))
    await importing(client, job, office, { lineIds: [zero.id, priced.id] })

    const charges = await chargesOf(job)
    assert.deepEqual(
      charges.map((charge) => [charge.quoteLineId, charge.description]),
      [[priced.id, long]]
    )
    assert.isAbove(long.length, 255)
  })

  test("a Technician can't remove a line Office imported onto their Visit", async ({
    client,
    assert,
  }) => {
    const { office, anna, job, visit, itemLine } = await quotedJob()
    await importing(client, job, office, { lineIds: [itemLine.id], visitId: visit.id })
    const [charge] = await chargesOf(job)

    const refused = await client
      .delete(`/charges/${charge.id}`)
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)

    refused.assertFlashMessage('error', it('flash.fieldWorkRefused.reviewed'))
    assert.isNotNull(await Charge.find(charge.id))
  })

  test('the Admin imports too; Technicians and the Superuser can not', async ({
    client,
    assert,
  }) => {
    const { anna, job, callOutLine } = await quotedJob()
    const superuser = await createUser('superuser')
    for (const user of [anna, superuser]) {
      const response = await client
        .post(`/jobs/${job.id}/quote/import`)
        .json({ lineIds: [callOutLine.id] })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await chargesOf(job), 0)

    const admin = await createUser('admin')
    const allowed = await importing(client, job, admin, { lineIds: [callOutLine.id] })
    allowed.assertFlashMessage('success', it('flash.quoteLinesImported', { count: 1 }))
    assert.lengthOf(await chargesOf(job), 1)
  })
})
