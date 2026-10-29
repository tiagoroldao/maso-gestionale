import { test } from '@japa/runner'
import type { Assert } from '@japa/assert'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type Charge from '#models/charge'
import Customer from '#models/customer'
import Invoice from '#models/invoice'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import type User from '#models/user'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Jobs from '#services/jobs'
import Scheduling from '#services/scheduling'
import StockLedger from '#stock/stock_ledger'
import { VISIT_BILLED_SQL, WORK_VISIT_SQL } from '#services/job_status'
import { isWorkVisit } from '#shared/visits'
import { isVisitBilled } from '#shared/charges'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { history, stateOf, workStatesOf } from '#tests/helpers/charges'
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

function visitOf(job: Job, attributes: Partial<Visit> = {}, days = 0) {
  const startsAt = DateTime.fromISO('2026-10-03T09:00').plus({ days })
  return Visit.create({
    jobId: job.id,
    startsAt,
    endsAt: startsAt.plus({ hours: 2 }),
    status: 'planned',
    ...attributes,
  })
}

/**
 * The Charge's work state, asserted to agree in TypeScript and SQL.
 */
async function workOf(assert: Assert, charge: Charge) {
  const { ts, sql } = await workStatesOf(charge)
  assert.equal(sql, ts, `work state of Charge ${charge.id}`)
  return ts
}

/**
 * Whether the Visit counts as work (isWorkVisit()) and is billed
 * (isVisitBilled()), asserted to agree with WORK_VISIT_SQL and
 * VISIT_BILLED_SQL.
 */
async function visitFlags(assert: Assert, visit: Visit) {
  await visit.refresh()
  const charges = await visit
    .related('charges')
    .query()
    .preload('events', (events) => events.orderBy('id'))
    .preload('invoiceLines', (lines) => lines.preload('invoice'))
  const ts = {
    work: isWorkVisit(visit),
    billed: isVisitBilled(
      visit.status,
      charges.map((charge) => ({ state: charge.state, work: charge.workState }))
    ),
  }
  const row = await db
    .from('visits as v')
    .where('v.id', visit.id)
    .select(db.raw(`${WORK_VISIT_SQL('v')} AS work`), db.raw(`${VISIT_BILLED_SQL('v')} AS billed`))
    .firstOrFail()
  assert.deepEqual({ work: Boolean(row.work), billed: Boolean(row.billed) }, ts, `${visit.id}`)
  return ts
}

/**
 * A Job in progress whose only work Visit, planned, has Anna's 2 hours and
 * 3 valves recorded; 10 valves in stock.
 */
async function plannedWork() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician', { fullName: 'Anna' })
  const job = await createJob(await createCustomer(), { status: 'in_progress' })
  const visit = await visitOf(job, { status: 'in_progress' })
  await visit.related('technicians').attach([anna.id])
  const rate = await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })
  await StockLedger.receive(valve, { quantity: '10', occurredOn: DateTime.now() })
  const hours = await FieldWork.recordHours(
    visit,
    { technicianId: anna.id, labourRateId: rate.id, hours: '2' },
    anna
  )
  const valves = await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '3' }, anna)
  return { office, anna, job, visit, rate, valve, hours, valves }
}

/**
 * Lists the Jobs a Jobs-list filter shows (SQL).
 */
async function listed(client: ApiClient, user: User, status: string) {
  const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(user)
  return (list.inertiaProps.jobs as { id: number }[]).map((row) => row.id)
}

/**
 * The Job's indicators on its page (TypeScript).
 */
async function indicatorsOf(client: ApiClient, user: User, job: Job) {
  const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
  return (page.inertiaProps.job as { indicators: { workComplete: boolean; invoiced: boolean } })
    .indicators
}

test.group('Cancelled Visits (#157)', () => {
  test('{$self} cancels a Visit: its Charges become not done, the Job is open again')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { job, visit, valve, hours, valves } = await plannedWork()

      const edit = await client.get(`/visits/${visit.id}/edit`).withInertia().loginAs(user)
      edit.assertInertiaPropsContains({ visit: { cancellable: true, restorable: false } })

      const response = await post(client, user, `/visits/${visit.id}/cancel`)
      response.assertHeader('location', `/jobs/${job.id}`)
      response.assertFlashMessage('success', it('flash.visitCancelled'))

      await visit.refresh()
      assert.equal(visit.status, 'cancelled')
      assert.isNotNull(visit.cancelledAt)
      for (const charge of [hours, valves]) {
        assert.equal(await workOf(assert, charge), 'not_done')
        assert.deepEqual(await history(charge), ['recorded', 'not_done'])
      }
      // Nothing moved in stock: planned Charges were never off it
      assert.equal(await StockLedger.levelOf(valve), '10.000')
      assert.lengthOf(await StockMovement.query().whereNot('kind', 'receipt'), 0)
      // Its only work Visit cancelled: no work, so the Job is open again
      await job.refresh()
      assert.equal(job.status, 'open')
      assert.deepEqual(await visitFlags(assert, visit), { work: false, billed: true })

      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
      page.assertInertiaPropsContains({
        visits: [{ id: visit.id, status: 'cancelled', billed: false, closableByOffice: false }],
        leftToClose: { visits: 0, charges: 0 },
      })
      const after = await client.get(`/visits/${visit.id}/edit`).withInertia().loginAs(user)
      after.assertInertiaPropsContains({
        visit: { status: 'cancelled', editable: false, cancellable: false, restorable: true },
      })
    })

  test('{$self} restores it: planned again, its Charges too, the Job in progress')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { job, visit, valve, hours, valves } = await plannedWork()
      const committed = async () => {
        const quantities = await StockLedger.quantities([valve.id])
        return quantities.get(valve.id)!
      }
      assert.deepEqual(await committed(), {
        inStock: '10.000',
        committed: '3.000',
        available: '7.000',
      })
      await post(client, user, `/visits/${visit.id}/cancel`)
      // Not done: its valves no longer commit anything (#158)
      assert.deepEqual(await committed(), {
        inStock: '10.000',
        committed: '0.000',
        available: '10.000',
      })

      const response = await post(client, user, `/visits/${visit.id}/restore`)
      response.assertHeader('location', `/jobs/${job.id}`)
      response.assertFlashMessage('success', it('flash.visitRestored'))

      await visit.refresh()
      assert.equal(visit.status, 'planned')
      assert.isNull(visit.cancelledAt)
      for (const charge of [hours, valves]) {
        assert.equal(await workOf(assert, charge), 'planned')
        assert.deepEqual(await history(charge), ['recorded', 'not_done', 'planned'])
      }
      // Planned again, committed again; nothing left stock
      assert.deepEqual(await committed(), {
        inStock: '10.000',
        committed: '3.000',
        available: '7.000',
      })
      await job.refresh()
      assert.equal(job.status, 'in_progress')
      assert.deepEqual(await visitFlags(assert, visit), { work: true, billed: false })

      // Back in the field: closing it reviews the Charges as usual
      const anna = await createUser('technician')
      await visit.related('technicians').attach([anna.id])
      await FieldWork.setStatus(visit, 'done', anna)
      assert.equal(await workOf(assert, valves), 'done')
    })

  test('Technicians and the Superuser can not cancel or restore', async ({ client, assert }) => {
    const { anna, job, visit, valves } = await plannedWork()
    const cancelled = await visitOf(job, {}, 1)
    await Scheduling.cancel(cancelled, await createUser('office'))

    for (const user of [anna, await createUser('technician'), await createUser('superuser')]) {
      const cancel = await post(client, user, `/visits/${visit.id}/cancel`)
      cancel.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      const restore = await post(client, user, `/visits/${cancelled.id}/restore`)
      restore.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    await visit.refresh()
    assert.equal(visit.status, 'in_progress')
    assert.equal(await workOf(assert, valves), 'planned')
    await cancelled.refresh()
    assert.equal(cancelled.status, 'cancelled')

    // Nor through the field route: a Technician sets field statuses only
    const field = await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'cancelled' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    assert.properties(field.flashMessage('inputErrorsBag'), ['status'])
    await visit.refresh()
    assert.equal(visit.status, 'in_progress')
  })

  test('only a planned or ongoing Visit is cancelled, only a cancelled one restored', async ({
    client,
    assert,
  }) => {
    const { office, anna, job, visit, valves } = await plannedWork()
    const planned = await visitOf(job, {}, 1)
    await FieldWork.setStatus(visit, 'done', anna)
    const needsReturn = await visitOf(job, { status: 'needs_return' }, 2)

    for (const closed of [visit, needsReturn]) {
      const response = await post(client, office, `/visits/${closed.id}/cancel`)
      response.assertFlashMessage('error', it('flash.visitCancelRefused.notOpen'))
      await closed.refresh()
      assert.notEqual(closed.status, 'cancelled')
    }
    assert.equal(await workOf(assert, valves), 'done')

    const restore = await post(client, office, `/visits/${planned.id}/restore`)
    restore.assertFlashMessage('error', it('flash.visitCancelRefused.notCancelled'))
    await planned.refresh()
    assert.equal(planned.status, 'planned')

    // Cancelling twice changes nothing more
    await post(client, office, `/visits/${planned.id}/cancel`)
    const again = await post(client, office, `/visits/${planned.id}/cancel`)
    again.assertFlashMessage('error', it('flash.visitCancelRefused.notOpen'))
  })

  test("a closed or cancelled Job's Visits are neither cancelled nor restored", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    for (const status of ['closed', 'cancelled'] as const) {
      const job = await createJob(await createCustomer(), { status: 'in_progress' })
      const open = await visitOf(job)
      const cancelled = await visitOf(job, {}, 1)
      await Scheduling.cancel(cancelled, office)
      await job.merge({ status }).save()

      const cancel = await post(client, office, `/visits/${open.id}/cancel`)
      cancel.assertFlashMessage('error', it(`flash.visitCancelRefused.${status}`))
      const restore = await post(client, office, `/visits/${cancelled.id}/restore`)
      restore.assertFlashMessage('error', it(`flash.visitCancelRefused.${status}`))
      await open.refresh()
      assert.equal(open.status, 'planned')
      await cancelled.refresh()
      assert.equal(cancelled.status, 'cancelled')

      const page = await client.get(`/visits/${open.id}/edit`).withInertia().loginAs(office)
      page.assertInertiaPropsContains({ visit: { cancellable: false, restorable: false } })
      const other = await client.get(`/visits/${cancelled.id}/edit`).withInertia().loginAs(office)
      other.assertInertiaPropsContains({ visit: { cancellable: false, restorable: false } })
    }
  })

  test('refused while a draft holds one of its Charges, or an issued Invoice bills it', async ({
    client,
    assert,
  }) => {
    const { office, job, visit, valves } = await plannedWork()
    // Only possible with data from before work states: a draft line holding
    // a planned Charge
    const invoice = await Invoices.create(await Customer.findOrFail(job.customerId))
    await invoice.merge({ jobId: job.id }).save()
    const standard = await vatCode()
    await Invoices.save(invoice, {
      lines: [{ description: 'Valvole', quantity: '3', unitPrice: '7.5', vatCodeId: standard.id }],
    })
    await invoice.load('lines')
    await db.table('invoice_line_charges').insert({
      invoice_line_id: invoice.lines[0].id,
      charge_id: valves.id,
      created_at: new Date(),
    })
    assert.equal(await stateOf(valves), 'in_draft')

    const held = await post(client, office, `/visits/${visit.id}/cancel`)
    held.assertFlashMessage('error', it('flash.visitCancelRefused.inDraft'))
    await visit.refresh()
    assert.equal(visit.status, 'in_progress')
    assert.equal(await workOf(assert, valves), 'planned')

    await Invoices.finalise(await Invoice.findOrFail(invoice.id))
    assert.equal(await stateOf(valves), 'billed')
    const billed = await post(client, office, `/visits/${visit.id}/cancel`)
    billed.assertFlashMessage('error', it('flash.visitCancelRefused.frozen'))
    await visit.refresh()
    assert.equal(visit.status, 'in_progress')
    assert.equal(await workOf(assert, valves), 'planned')
  })

  test("a cancelled Visit is read-only: field work, the Agenda and Office's changes", async ({
    client,
    assert,
  }) => {
    const { office, anna, job, visit, rate, valve, valves } = await plannedWork()
    await post(client, office, `/visits/${visit.id}/cancel`)

    // The field: refused, and gone from the Technician's list
    const hours = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '1' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    hours.assertFlashMessage('error', it('flash.fieldWorkRefused.visitCancelled'))
    const item = await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(valve.id), quantity: '1' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    item.assertFlashMessage('error', it('flash.fieldWorkRefused.visitCancelled'))
    const note = await client
      .post(`/my-visits/${visit.id}/notes`)
      .form({ body: 'Cliente assente' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    note.assertFlashMessage('error', it('flash.fieldWorkRefused.visitCancelled'))
    const status = await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    status.assertFlashMessage('error', it('flash.fieldWorkRefused.visitCancelled'))
    const removed = await client
      .delete(`/charges/${valves.id}`)
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    removed.assertFlashMessage('error', it('flash.fieldWorkRefused.visitCancelled'))
    assert.lengthOf(await visit.related('charges').query(), 2)
    assert.lengthOf(await visit.related('fieldNotes').query(), 0)

    const list = await client.get('/my-visits').withInertia().loginAs(anna)
    assert.deepEqual(list.inertiaProps.visits, [])
    const show = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    show.assertInertiaPropsContains({ visit: { status: 'cancelled' }, done: true })

    // The Agenda: still there, as cancelled, and it doesn't move
    const agenda = await client
      .get('/agenda')
      .qs({ date: '2026-10-03' })
      .withInertia()
      .loginAs(office)
    agenda.assertInertiaPropsContains({
      visits: [{ id: visit.id, status: 'cancelled', movable: false }],
    })
    const moved = await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-10-04T09:00' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    moved.assertFlashMessage('error', it('flash.visitNotMovable'))
    const updated = await client
      .put(`/visits/${visit.id}`)
      .json({
        date: '2026-10-04',
        startTime: '09:00',
        durationMinutes: 120,
        technicianIds: [anna.id],
      })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    updated.assertFlashMessage('error', it('flash.visitNotEditable'))
    const deleted = await client
      .delete(`/visits/${visit.id}`)
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    deleted.assertFlashMessage('error', it('flash.visitNotEditable'))
    await visit.refresh()
    assert.equal(visit.status, 'cancelled')
    assert.equal(visit.startsAt.toISODate(), '2026-10-03')

    // Its Charges stay not done until it is restored
    const done = await post(client, office, `/charges/${valves.id}/done`)
    done.assertFlashMessage('error', it('flash.chargeRefused.visitCancelled'))
    assert.equal(await workOf(assert, valves), 'not_done')
    assert.equal(await StockLedger.levelOf(valve), '10.000')

    // Cancelling the Job afterwards: Office can't mark it done (it didn't happen)
    await Jobs.cancel(job.id)
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ visits: [{ id: visit.id, closableByOffice: false }] })
    const markDone = await post(client, office, `/visits/${visit.id}/done`)
    markDone.assertFlashMessage('error', it('flash.fieldWorkRefused.visitCancelled'))
    await visit.refresh()
    assert.equal(visit.status, 'cancelled')
  })

  test('the page (TypeScript) and the filters (SQL) ignore cancelled Visits alike', async ({
    client,
    assert,
  }) => {
    const { office, anna, job, visit } = await plannedWork()
    await FieldWork.setStatus(visit, 'done', anna)
    const invoice = await Invoices.fromJob(job)
    await Invoices.finalise(invoice)

    // Done, billed, and a Visit cancelled afterwards: complete and invoiced
    const later = await visitOf(job, {}, 3)
    await post(client, office, `/visits/${later.id}/cancel`)
    assert.deepEqual(await visitFlags(assert, later), { work: false, billed: true })
    await job.refresh()
    assert.equal(job.status, 'in_progress')
    assert.include(await listed(client, office, 'work_complete'), job.id)
    assert.include(await listed(client, office, 'invoiced'), job.id)
    assert.deepEqual(await indicatorsOf(client, office, job), {
      workComplete: true,
      invoiced: true,
      paid: false,
    })

    // A Visit needing another one, whose follow-up was cancelled, is still
    // to do, and waits on the "to schedule" list
    const back = await visitOf(job, { status: 'needs_return' }, 1)
    const followUp = await visitOf(job, {}, 2)
    await post(client, office, `/visits/${followUp.id}/cancel`)
    assert.notInclude(await listed(client, office, 'work_complete'), job.id)
    const waiting = await indicatorsOf(client, office, job)
    assert.isFalse(waiting.workComplete)
    const left = await Jobs.leftToClose(job.id)
    assert.equal(left.visits, 1)
    const toSchedule = await client.get('/agenda/to-schedule').withInertia().loginAs(office)
    assert.deepEqual(
      (toSchedule.inertiaProps.visits as { id: number }[]).map((row) => row.id),
      [back.id]
    )

    // A Job with only a cancelled work Visit (and a Survey) has no work
    const surveyed = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(surveyed, { survey: true, status: 'done' })
    const only = await visitOf(surveyed, {}, 1)
    await post(client, office, `/visits/${only.id}/cancel`)
    await surveyed.refresh()
    assert.equal(surveyed.status, 'open')
    assert.notInclude(await listed(client, office, 'work_complete'), surveyed.id)
    const noWork = await indicatorsOf(client, office, surveyed)
    assert.isFalse(noWork.workComplete)
  })

  test('reopening a closed Job counts only Visits that are work', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const visit = await visitOf(job)
    await post(client, office, `/visits/${visit.id}/cancel`)
    await job.refresh()
    assert.equal(job.status, 'open')
    await post(client, office, `/jobs/${job.id}/close`)
    await post(client, office, `/jobs/${job.id}/reopen`)
    await job.refresh()
    assert.equal(job.status, 'open')
  })

  test("cancelling a Job doesn't count its cancelled Visits as left open", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const visit = await visitOf(job)
    await post(client, office, `/visits/${visit.id}/cancel`)
    const response = await post(client, office, `/jobs/${job.id}/cancel`)
    response.assertFlashMessage('success', it('flash.jobCancelled', { number: job.number }))
    const fresh = await Job.findOrFail(job.id)
    assert.equal(fresh.status, 'cancelled')
  })
})
