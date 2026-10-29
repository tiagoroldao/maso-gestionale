import { test } from '@japa/runner'
import type { Assert } from '@japa/assert'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import type User from '#models/user'
import Visit from '#models/visit'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Invoices, { JobNotInvoiceableError } from '#services/invoices'
import Jobs from '#services/jobs'
import Quotes from '#services/quotes'
import Submissions from '#services/submissions'
import StockLedger from '#stock/stock_ledger'
import TemplateData from '#services/template_data'
import {
  keepWorkEvents,
  migrateWorkStates,
  restoreWorkEvents,
} from '#database/migrations/1761885935224_charge_work_states'
import { VISIT_BILLED_SQL } from '#services/job_status'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { history, workStatesOf } from '#tests/helpers/charges'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

function post(client: ApiClient, user: User, url: string, body: Record<string, unknown> = {}) {
  return client
    .post(url)
    .json(body)
    .header('referer', '/')
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

/**
 * The Charge's work state, asserted to agree in TypeScript and SQL.
 */
async function workOf(assert: Assert, charge: Charge) {
  const { ts, sql } = await workStatesOf(charge)
  assert.equal(sql, ts, `work state of Charge ${charge.id}`)
  return ts
}

async function stockOf(itemId: number) {
  const movements = await StockMovement.query().where('itemId', itemId).orderBy('id')
  return movements.map((movement) => [movement.kind, movement.quantity])
}

async function billingOpen(job: Job) {
  const row = await Job.query()
    .withScopes((scopes) => scopes.withBillingState())
    .where('id', job.id)
    .firstOrFail()
  return Boolean(row.$extras.billing_open)
}

/**
 * A Job in progress with an open Visit where Anna recorded 2 hours, 3
 * valves and a pump; 10 valves and 2 pumps in stock.
 */
async function openVisit() {
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
  const rate = await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })
  const pump = await createItem({ description: 'Pompa', unit: 'pz', resalePrice: '300' })
  await StockLedger.receive(valve, { quantity: '10', occurredOn: start })
  await StockLedger.receive(pump, { quantity: '2', occurredOn: start })
  const hours = await FieldWork.recordHours(
    visit,
    { technicianId: anna.id, labourRateId: rate.id, hours: '2' },
    anna
  )
  const valves = await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '3' }, anna)
  const pumpLine = await FieldWork.recordItem(visit, { itemId: pump.id, quantity: '1' }, anna)
  return { office, anna, job, visit, rate, valve, pump, hours, valves, pumpLine }
}

/**
 * The same Visit, closed with every Charge done.
 */
async function closedVisit() {
  const setup = await openVisit()
  await FieldWork.setStatus(setup.visit, 'done', setup.anna)
  return setup
}

/**
 * A Job with an accepted Quote (a boiler, 4 hours and a call-out),
 * imported onto the Job itself; 3 boilers in stock.
 */
async function quotedJob() {
  await completeCompany()
  const office = await createUser('office')
  const job = await createJob(await createCustomer(), { status: 'in_progress' })
  const boiler = await createItem({ description: 'Caldaia', unit: 'pz' })
  await StockLedger.receive(boiler, { quantity: '3', occurredOn: DateTime.now() })
  const rate = await LabourRate.firstOrCreate({ name: 'Posa' }, { hourlyPrice: '40' })
  const standard = await vatCode()
  const quote = await Quotes.create(job, {
    lines: [
      {
        kind: 'item',
        itemId: boiler.id,
        description: 'Caldaia',
        quantity: '1',
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
      {
        kind: 'call_out',
        description: 'Diritto di chiamata',
        quantity: '1',
        unitPrice: '30',
        vatCodeId: standard.id,
      },
    ],
  })
  await Quotes.accept(quote)
  await job.refresh()
  await quote.load('lines')
  const [boilerCharge, labour, callOut] = await Quotes.importLines(
    quote,
    { lineIds: quote.lines.map((line) => line.id), workerName: 'Ditta Rossi' },
    office
  )
  return { office, job, boiler, boilerCharge, labour, callOut }
}

/**
 * Takes a finalised Invoice (or Credit Note) through SDI to delivered.
 */
async function delivered(invoice: Invoice) {
  await Submissions.prepare(invoice)
  await Submissions.confirm(invoice, 'Sconto')
  await Submissions.recordOutcome(invoice, { outcome: 'delivered' })
  await invoice.refresh()
  return invoice
}

/**
 * The Job's Invoice from its Charges, finalised and delivered.
 */
async function invoiced(job: Job) {
  const invoice = await Invoices.fromJob(job)
  await Invoices.finalise(invoice)
  await invoice.refresh()
  return delivered(invoice)
}

/**
 * A Credit Note crediting in full the line of `invoice` that bills
 * `charge`, finalised and delivered.
 */
async function creditInFull(invoice: Invoice, charge: Charge, deliver = true) {
  const row = await db
    .from('invoice_line_charges as lc')
    .join('invoice_lines as l', 'l.id', 'lc.invoice_line_id')
    .where('l.invoice_id', invoice.id)
    .where('lc.charge_id', charge.id)
    .select('l.id')
    .firstOrFail()
  const line = await InvoiceLine.findOrFail(row.id)
  const note = await Invoices.createCreditNote(invoice)
  await Invoices.save(note, {
    lines: [
      {
        creditsLineId: line.id,
        description: line.description,
        quantity: '1',
        unitPrice: line.lineTotal,
        vatCodeId: line.vatCodeId,
      },
    ],
  })
  await note.refresh()
  await Invoices.finalise(note)
  await note.refresh()
  return deliver ? delivered(note) : note
}

async function visitBilledSql(visit: Visit) {
  const row = await db
    .from('visits as v')
    .where('v.id', visit.id)
    .select(db.raw(`${VISIT_BILLED_SQL('v')} AS billed`))
    .firstOrFail()
  return Boolean(row.billed)
}

test.group('Work state: closing a Visit reviews its Charges', () => {
  test('planned until the Visit closes; unticked ones become not done and stay in stock', async ({
    client,
    assert,
  }) => {
    const { anna, job, visit, valve, pump, hours, valves, pumpLine } = await openVisit()
    for (const charge of [hours, valves, pumpLine]) {
      assert.equal(await workOf(assert, charge), 'planned')
    }

    // The close form lists every hour and Item, all ticked
    const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    page.assertInertiaPropsContains({
      hours: [{ id: hours.id, notDone: false }],
      items: [
        { id: valves.id, notDone: false },
        { id: pumpLine.id, notDone: false },
      ],
    })
    // A colleague records more meanwhile: not in the review, so done
    const late = await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '1' }, anna)

    const response = await post(client, anna, `/my-visits/${visit.id}/status`, {
      status: 'done',
      reviewed: [hours.id, valves.id, pumpLine.id],
      done: [hours.id, valves.id],
    })
    response.assertFlashMessage('success', it('flash.visitStatusSaved'))

    assert.equal(await workOf(assert, hours), 'done')
    assert.equal(await workOf(assert, valves), 'done')
    assert.equal(await workOf(assert, late), 'done')
    assert.equal(await workOf(assert, pumpLine), 'not_done')
    assert.deepEqual(await history(pumpLine), ['recorded', 'not_done'])
    const used = await StockMovement.query().where('itemId', valve.id).where('kind', 'usage')
    assert.deepEqual(
      used.map((movement) => [
        movement.quantity,
        movement.occurredOn.toISODate(),
        movement.reference,
      ]),
      [
        ['-3.000', '2026-10-20', job.number],
        ['-1.000', '2026-10-20', job.number],
      ]
    )
    // Documents list the Items used: not the pump
    const listed = await TemplateData.itemsUsed(job)
    assert.deepEqual(
      listed.map((row) => [row.description, row.quantity]),
      [['Valvola', '4']]
    )
    // The pump never left
    assert.deepEqual(await stockOf(pump.id), [['receipt', '2.000']])
    await pumpLine.refresh()
    assert.isNull(pumpLine.stockMovementId)

    // Read-only now, the line shows it wasn't done
    const closed = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    closed.assertInertiaPropsContains({
      done: true,
      items: [
        { id: valves.id, notDone: false },
        { id: pumpLine.id, notDone: true },
        { id: late.id, notDone: false },
      ],
    })
  })

  test('"needs another visit" reviews them too; without a review every one is done', async ({
    client,
    assert,
  }) => {
    const { anna, visit, hours, valves, pumpLine } = await openVisit()
    await post(client, anna, `/my-visits/${visit.id}/status`, {
      status: 'needs_return',
      reviewed: [hours.id, valves.id, pumpLine.id],
      done: [valves.id, pumpLine.id],
    })
    assert.equal(await workOf(assert, hours), 'not_done')
    assert.equal(await workOf(assert, valves), 'done')

    const other = await openVisit()
    await post(client, other.anna, `/my-visits/${other.visit.id}/status`, { status: 'done' })
    for (const charge of [other.hours, other.valves, other.pumpLine]) {
      assert.equal(await workOf(assert, charge), 'done')
    }
  })

  test('{$self} closing a Visit left open on a cancelled Job reviews its Charges')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { job, visit, pump, hours, valves, pumpLine } = await openVisit()
      await post(client, user, `/jobs/${job.id}/cancel`)

      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
      page.assertInertiaPropsContains({
        visits: [
          {
            id: visit.id,
            closableByOffice: true,
            charges: [{ id: hours.id }, { id: valves.id }, { id: pumpLine.id }],
          },
        ],
      })

      const response = await post(client, user, `/visits/${visit.id}/done`, {
        reviewed: [hours.id, valves.id, pumpLine.id],
        done: [hours.id, valves.id],
      })
      response.assertFlashMessage('success', it('flash.visitMarkedDone'))
      assert.equal(await workOf(assert, valves), 'done')
      assert.equal(await workOf(assert, pumpLine), 'not_done')
      assert.deepEqual(await stockOf(pump.id), [['receipt', '2.000']])
      // Only done work is billed
      const invoice = await Invoices.fromJob(job)
      const held = await db
        .from('invoice_line_charges as lc')
        .join('invoice_lines as l', 'l.id', 'lc.invoice_line_id')
        .where('l.invoice_id', invoice.id)
        .orderBy('lc.charge_id')
        .select('lc.charge_id')
      assert.deepEqual(
        held.map((row) => row.charge_id),
        [hours.id, valves.id]
      )
    })
})

test.group('Work state: Office switches done and not done', () => {
  test("{$self} switches a closed Visit's Item; stock follows by the difference")
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { job, valve, valves, hours } = await closedVisit()
      const today = DateTime.now().toISODate()

      const off = await post(client, user, `/charges/${valves.id}/not-done`)
      off.assertFlashMessage('success', it('flash.chargeWork.not_done'))
      assert.equal(await workOf(assert, valves), 'not_done')
      await valves.refresh()
      assert.isNull(valves.stockMovementId)
      const back = await StockMovement.query()
        .where('itemId', valve.id)
        .orderBy('id', 'desc')
        .firstOrFail()
      assert.deepEqual(
        [back.kind, back.quantity, back.occurredOn.toISODate(), back.reference, back.reason],
        ['adjustment', '3.000', today, job.number, `Addebito n. ${valves.id} non eseguito`]
      )
      assert.equal(await StockLedger.levelOf(valve), '10.000')
      // Never outstanding (the hours and the pump are), so never in a draft
      const left = await Jobs.leftToClose(job.id)
      assert.equal(left.charges, 2)

      // Marking it again changes nothing
      await post(client, user, `/charges/${valves.id}/not-done`)
      assert.deepEqual(await history(valves), ['recorded', 'done', 'not_done'])

      const on = await post(client, user, `/charges/${valves.id}/done`)
      on.assertFlashMessage('success', it('flash.chargeWork.done'))
      assert.equal(await workOf(assert, valves), 'done')
      await valves.refresh()
      const usage = await StockMovement.findOrFail(valves.stockMovementId)
      assert.deepEqual(
        [usage.kind, usage.quantity, usage.occurredOn.toISODate(), usage.reference],
        // Used on the Visit's work day, its planned day here (#174)
        ['usage', '-3.000', '2026-10-20', job.number]
      )
      assert.equal(await StockLedger.levelOf(valve), '7.000')

      // Hours have no stock to move
      await post(client, user, `/charges/${hours.id}/not-done`)
      assert.equal(await workOf(assert, hours), 'not_done')
      const page = await client.get(`/charges/${hours.id}/edit`).withInertia().loginAs(user)
      page.assertInertiaPropsContains({
        charge: { workState: 'not_done', canSetWork: true, frozen: false },
      })
    })

  test('a Visit still open keeps its Charges planned', async ({ client, assert }) => {
    const { office, visit, valves } = await openVisit()
    const response = await post(client, office, `/charges/${valves.id}/done`)
    response.assertFlashMessage('error', it('flash.chargeRefused.visitOpen'))
    assert.equal(await workOf(assert, valves), 'planned')
    assert.deepEqual(await history(valves), ['recorded'])
    await valves.refresh()
    assert.isNull(valves.stockMovementId)
    const page = await client.get(`/charges/${valves.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ charge: { workState: 'planned', canSetWork: false } })
    assert.equal(visit.status, 'in_progress')
  })

  test('refused while a draft holds it; billed, frozen until a Credit Note credits it', async ({
    client,
    assert,
  }) => {
    const { office, job, valve, valves, hours } = await closedVisit()
    const draft = await Invoices.fromJob(job)

    const held = await post(client, office, `/charges/${valves.id}/not-done`)
    held.assertFlashMessage('error', it('flash.chargeRefused.inDraft'))
    assert.equal(await workOf(assert, valves), 'done')
    const heldPage = await client.get(`/charges/${valves.id}/edit`).withInertia().loginAs(office)
    heldPage.assertInertiaPropsContains({ charge: { canSetWork: false, frozen: false } })

    await Invoices.finalise(draft)
    const invoice = await delivered(await Invoice.findOrFail(draft.id))
    const billed = await post(client, office, `/charges/${valves.id}/not-done`)
    billed.assertFlashMessage('error', it('flash.chargeRefused.frozen'))
    // Its recorded quantity is frozen too, and its Item
    const corrected = await client
      .put(`/charges/${valves.id}/recorded`)
      .form({ itemId: String(valve.id), quantity: '2' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    corrected.assertFlashMessage('error', it('flash.chargeRefused.frozen'))
    await valves.refresh()
    assert.equal(valves.quantity, '3.000')
    // Who worked can still be put right: no stock or quantity changes
    const worker = await client
      .put(`/charges/${hours.id}/recorded`)
      .form({ labourRateId: String(hours.labourRateId), workerName: 'Ditta Rossi', quantity: '2' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    worker.assertFlashMessage('success', it('flash.chargeCorrected'))

    // Set back to bill, only its billing side reopens
    await post(client, office, `/charges/${valves.id}/to-bill`)
    const setBack = await post(client, office, `/charges/${valves.id}/not-done`)
    setBack.assertFlashMessage('error', it('flash.chargeRefused.frozen'))
    const page = await client.get(`/charges/${valves.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      charge: { state: 'to_bill', canSetWork: false, frozen: true },
    })
    assert.deepEqual(await history(valves), ['recorded', 'done', 'billed', 'unbilled'])

    // Credited in full: the goods can come back
    await creditInFull(invoice, valves)
    const credited = await post(client, office, `/charges/${valves.id}/not-done`)
    credited.assertFlashMessage('success', it('flash.chargeWork.not_done'))
    assert.equal(await workOf(assert, valves), 'not_done')
    assert.equal(await StockLedger.levelOf(valve), '10.000')
  })

  test('a billed Charge credited in full can be switched and corrected', async ({
    client,
    assert,
  }) => {
    const { office, job, valve, valves } = await closedVisit()
    const invoice = await invoiced(job)
    await creditInFull(invoice, valves)

    const corrected = await client
      .put(`/charges/${valves.id}/recorded`)
      .form({ itemId: String(valve.id), quantity: '2' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    corrected.assertFlashMessage('success', it('flash.chargeCorrected'))
    assert.equal(await StockLedger.levelOf(valve), '8.000')
  })

  test('only Admin and Office set the work state', async ({ client, assert }) => {
    const { anna, valves } = await closedVisit()
    for (const user of [anna, await createUser('technician'), await createUser('superuser')]) {
      for (const url of [`/charges/${valves.id}/done`, `/charges/${valves.id}/not-done`]) {
        const denied = await post(client, user, url)
        denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.equal(await workOf(assert, valves), 'done')
    assert.deepEqual(await history(valves), ['recorded', 'done'])
  })
})

test.group('Work state: billing in TypeScript and SQL', () => {
  test('a closed Visit is billed once its done Charges are, whatever is not done', async ({
    client,
    assert,
  }) => {
    const { office, job, visit, valves, pumpLine } = await closedVisit()
    await Charges.setWorkState(valves, 'not_done', office, 'Non usato')
    await Charges.setWorkState(pumpLine, 'not_done', office, 'Non usato')
    const billedOnPage = async () => {
      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
      return page.inertiaProps.visits.find((row: { id: number }) => row.id === visit.id).billed
    }
    assert.isFalse(await billedOnPage())
    assert.isFalse(await visitBilledSql(visit))

    // The hours, its only done Charge, billed: nothing is left
    await invoiced(job)
    assert.isTrue(await billedOnPage())
    assert.isTrue(await visitBilledSql(visit))
    assert.isFalse(await billingOpen(job))
  })

  test('a Credit Note unfreezes the Charge only once SDI delivers it', async ({
    client,
    assert,
  }) => {
    const { office, job, valve, valves } = await closedVisit()
    const invoice = await invoiced(job)
    const note = await creditInFull(invoice, valves, false)
    const finalised = await post(client, office, `/charges/${valves.id}/not-done`)
    finalised.assertFlashMessage('error', it('flash.chargeRefused.frozen'))

    // Rejected, it may yet be corrected below the line
    await Submissions.prepare(note)
    await Submissions.confirm(note, 'Sconto')
    await Submissions.recordOutcome(note, { outcome: 'rejected' })
    const rejected = await post(client, office, `/charges/${valves.id}/not-done`)
    rejected.assertFlashMessage('error', it('flash.chargeRefused.frozen'))
    assert.equal(await workOf(assert, valves), 'done')

    await note.refresh()
    await delivered(note)
    const credited = await post(client, office, `/charges/${valves.id}/not-done`)
    credited.assertFlashMessage('success', it('flash.chargeWork.not_done'))
    assert.equal(await StockLedger.levelOf(valve), '10.000')
  })
})

test.group('Work state: Charges on the Job itself', () => {
  test("Office's costs start done; imported ones are planned until confirmed used", async ({
    client,
    assert,
  }) => {
    const { office, job, boiler, boilerCharge, labour, callOut } = await quotedJob()
    const cost = await Charges.add(
      job,
      { description: 'Noleggio', quantity: '1', unit: null, unitPrice: '50', vatKind: 'labour' },
      office
    )
    assert.equal(await workOf(assert, cost), 'done')
    for (const charge of [boilerCharge, labour, callOut]) {
      assert.equal(await workOf(assert, charge), 'planned')
    }

    // Planned work keeps billing open, but only done work is drafted
    assert.isTrue(await billingOpen(job))
    const left = await Jobs.leftToClose(job.id)
    assert.equal(left.charges, 4)
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      canInvoice: true,
      charges: [
        { id: boilerCharge.id, workState: 'planned', state: 'to_bill' },
        { id: labour.id, workState: 'planned' },
        { id: callOut.id, workState: 'planned' },
        { id: cost.id, workState: 'done' },
      ],
    })
    const first = await Invoices.fromJob(job)
    await first.load('lines')
    assert.deepEqual(
      first.lines.map((line) => line.description),
      ['Noleggio']
    )
    await Invoices.destroy(first)

    // Confirmed used: off stock today, referencing the Job
    const response = await post(client, office, `/charges/${boilerCharge.id}/done`)
    response.assertFlashMessage('success', it('flash.chargeWork.done'))
    assert.equal(await workOf(assert, boilerCharge), 'done')
    await boilerCharge.refresh()
    const usage = await StockMovement.findOrFail(boilerCharge.stockMovementId)
    assert.deepEqual(
      [usage.kind, usage.quantity, usage.occurredOn.toISODate(), usage.reference],
      ['usage', '-1.000', DateTime.now().toISODate(), job.number]
    )
    // The call-out never happened: not done, never billed or outstanding
    await post(client, office, `/charges/${callOut.id}/not-done`)
    assert.equal(await workOf(assert, callOut), 'not_done')
    assert.deepEqual(await stockOf(boiler.id), [
      ['receipt', '3.000'],
      ['usage', '-1.000'],
    ])

    const draft = await Invoices.fromJob(job)
    await draft.load('lines', (lines) => lines.orderBy('position'))
    assert.deepEqual(
      draft.lines.map((line) => line.description),
      ['Caldaia', 'Noleggio']
    )
    // The labour is still planned: no advance taken back, billing open
    await Invoices.finalise(draft)
    assert.isTrue(await billingOpen(job))
    await post(client, office, `/charges/${labour.id}/done`)
    const last = await invoiced(job)
    assert.isFalse(await billingOpen(job))
    assert.isNotNull(last.number)

    // Not done and confirmed: the boiler comes back when Office changes its mind
    const frozen = await post(client, office, `/charges/${boilerCharge.id}/not-done`)
    frozen.assertFlashMessage('error', it('flash.chargeRefused.frozen'))
  })

  test('a Job with only planned Charges has nothing to draft yet', async ({ client, assert }) => {
    const { office, job } = await quotedJob()
    // The page doesn't offer a draft fromJob would refuse
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })
    // Nor do documents list the boiler: it isn't used yet
    assert.deepEqual(await TemplateData.itemsUsed(job), [])
    try {
      await Invoices.fromJob(job)
      assert.fail('expected a refusal')
    } catch (error) {
      assert.instanceOf(error, JobNotInvoiceableError)
    }
  })

  test('a planned Job Charge confirmed used on a cancelled Job still leaves stock (#111)', async ({
    client,
    assert,
  }) => {
    const { office, job, boiler, boilerCharge } = await quotedJob()
    await post(client, office, `/jobs/${job.id}/cancel`)
    await job.refresh()
    assert.equal(job.status, 'cancelled')
    await post(client, office, `/charges/${boilerCharge.id}/done`)
    assert.equal(await workOf(assert, boilerCharge), 'done')
    assert.equal(await StockLedger.levelOf(boiler), '2.000')
  })
})

test.group('Work state: existing data (migration)', () => {
  test('Charges get their work state from what happened so far', async ({ assert }) => {
    // Charges as they were before work states: closed and open Visits,
    // Office's costs, imported Items on the Job (one billed, one drafted,
    // one neither), and an Item a rolled-back migration left not done
    const closed = await closedVisit()
    const open = await openVisit()
    const quoted = await quotedJob()
    const billedJob = await quotedJob()
    const draftedJob = await quotedJob()
    for (const setup of [billedJob, draftedJob]) {
      await Charges.setWorkState(setup.boilerCharge, 'done', setup.office, 'Usato')
      await Charges.setWorkState(setup.labour, 'done', setup.office, 'Usato')
      await Charges.setWorkState(setup.callOut, 'not_done', setup.office, 'Usato')
    }
    await invoiced(billedJob.job)
    await Invoices.fromJob(draftedJob.job)
    await Charges.setWorkState(closed.pumpLine, 'not_done', closed.office, 'Non usato')

    // As before the migration: no work events, Job Items never off stock
    for (const setup of [billedJob, draftedJob]) {
      await db
        .from('charges')
        .where('id', setup.boilerCharge.id)
        .update({ stock_movement_id: null })
      await db
        .from('stock_movements')
        .where('item_id', setup.boiler.id)
        .where('kind', 'usage')
        .delete()
    }
    await db.from('charge_events').whereIn('kind', ['planned', 'done', 'not_done']).delete()

    await migrateWorkStates(db)

    const expected: [Charge, string][] = [
      [closed.hours, 'done'],
      [closed.valves, 'done'],
      [closed.pumpLine, 'not_done'],
      [open.hours, 'planned'],
      [open.valves, 'planned'],
      [quoted.boilerCharge, 'planned'],
      [quoted.labour, 'done'],
      [quoted.callOut, 'done'],
      [billedJob.boilerCharge, 'done'],
      [draftedJob.boilerCharge, 'done'],
    ]
    for (const [charge, work] of expected) {
      assert.equal(await workOf(assert, charge), work, `Charge ${charge.id}`)
    }
    // Billed or drafted Items on the Job left stock, dated when invoiced
    const today = DateTime.now().toISODate()
    for (const setup of [billedJob, draftedJob]) {
      await setup.boilerCharge.refresh()
      const usage = await StockMovement.findOrFail(setup.boilerCharge.stockMovementId)
      assert.deepEqual(
        [usage.kind, usage.quantity, usage.occurredOn.toISODate(), usage.reference],
        ['usage', '-1.000', today, setup.job.number]
      )
    }
    // Nothing else moved
    assert.deepEqual(await stockOf(quoted.boiler.id), [['receipt', '3.000']])
    assert.deepEqual(await stockOf(closed.pump.id), [
      ['receipt', '2.000'],
      ['usage', '-1.000'],
      ['adjustment', '1.000'],
    ])
    const events = await ChargeEvent.query().whereIn('kind', ['planned', 'done', 'not_done'])
    assert.isTrue(events.every((event) => event.kind !== 'planned' && event.userId === null))

    // Run again, nothing changes
    const before = await db.from('charge_events').count('* as total')
    await migrateWorkStates(db)
    assert.deepEqual(await db.from('charge_events').count('* as total'), before)
  })

  test('rolled back and migrated again, every work state and the stock come back', async ({
    assert,
  }) => {
    // Billed, credited in full, then not done: the valves came back
    const closed = await closedVisit()
    const invoice = await invoiced(closed.job)
    await creditInFull(invoice, closed.valves)
    await Charges.setWorkState(closed.valves, 'not_done', closed.office, 'Reso')
    // Not done after the close: hours never worked; a Job cost never spent
    await Charges.setWorkState(closed.hours, 'done', closed.office, 'Usato')
    const other = await closedVisit()
    await Charges.setWorkState(other.hours, 'not_done', other.office, 'Non usato')
    const quoted = await quotedJob()
    await Charges.setWorkState(quoted.callOut, 'not_done', quoted.office, 'Non usato')
    await Charges.setWorkState(quoted.boilerCharge, 'done', quoted.office, 'Usato')
    const open = await openVisit()

    const charges = [
      closed.valves,
      closed.hours,
      closed.pumpLine,
      other.hours,
      other.valves,
      quoted.callOut,
      quoted.boilerCharge,
      quoted.labour,
      open.valves,
    ]
    const states = async () => {
      const found = []
      for (const charge of charges) found.push(await workOf(assert, charge))
      return found
    }
    const stock = async () =>
      [
        await StockLedger.levelOf(closed.valve),
        await StockLedger.levelOf(closed.pump),
        await StockLedger.levelOf(quoted.boiler),
      ].join(' ')
    const statesBefore = await states()
    const stockBefore = await stock()
    assert.deepEqual(statesBefore, [
      'not_done',
      'done',
      'done',
      'not_done',
      'done',
      'not_done',
      'done',
      'planned',
      'planned',
    ])

    // down
    await keepWorkEvents(db)
    assert.lengthOf(await ChargeEvent.query().whereIn('kind', ['planned', 'done', 'not_done']), 0)
    // up
    await restoreWorkEvents(db)
    await migrateWorkStates(db)

    assert.deepEqual(await states(), statesBefore)
    assert.equal(await stock(), stockBefore)
    const kept = await db.rawQuery(`SELECT to_regclass('charge_work_events_kept') AS kept`)
    assert.isNull(kept.rows[0].kept)
  })

  test('not done, then drafted or billed while rolled back: done again, off stock', async ({
    assert,
  }) => {
    const drafted = await closedVisit()
    const billed = await closedVisit()
    for (const setup of [drafted, billed]) {
      await Charges.setWorkState(setup.valves, 'not_done', setup.office, 'Non usato')
    }
    assert.equal(await StockLedger.levelOf(drafted.valve), '10.000')

    // down
    await keepWorkEvents(db)
    // Rolled back, a draft takes the valves as any recorded work: what
    // fromJob did then, here with a "done" event it takes back at once
    for (const setup of [drafted, billed]) {
      const done = await ChargeEvent.create({ chargeId: setup.valves.id, kind: 'done' })
      const draft = await Invoices.fromJob(setup.job)
      await done.delete()
      if (setup === billed) await Invoices.finalise(draft)
    }
    // up
    await restoreWorkEvents(db)
    await migrateWorkStates(db)

    for (const setup of [drafted, billed]) {
      assert.equal(await workOf(assert, setup.valves), 'done')
      await setup.valves.refresh()
      const usage = await StockMovement.findOrFail(setup.valves.stockMovementId)
      assert.deepEqual(
        [usage.kind, usage.quantity, usage.occurredOn.toISODate()],
        ['usage', '-3.000', '2026-10-20']
      )
      assert.equal(await StockLedger.levelOf(setup.valve), '7.000')
      // Its Visit's other Charges came back done, as they were
      assert.equal(await workOf(assert, setup.hours), 'done')
    }
  })
})
