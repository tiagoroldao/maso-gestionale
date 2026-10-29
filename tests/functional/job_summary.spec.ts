import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Big from 'big.js'
import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import type Job from '#models/job'
import LabourRate from '#models/labour_rate'
import type User from '#models/user'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import Jobs from '#services/jobs'
import Scheduling from '#services/scheduling'
import StockLedger from '#stock/stock_ledger'
import { WORK_STATE_SQL } from '#services/job_status'
import type { WorkTotals } from '#services/job_summary'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'

async function visitOn(job: Job, technician: User, day: number, status: Visit['status']) {
  const startsAt = DateTime.fromISO(`2026-10-${day}T09:00`)
  const visit = await Visit.create({
    jobId: job.id,
    startsAt,
    endsAt: startsAt.plus({ hours: 3 }),
    status,
  })
  await visit.related('technicians').attach([technician.id])
  return visit
}

/**
 * A long Job: 10 valves planned on the Job itself (as if imported from its
 * Quote); a Visit done, where Anna worked 2 hours and used 3 valves of the
 * 4 she recorded; a cancelled one, whose 4 valves are not done; and one
 * still planned, with 3 hours ahead.
 */
async function longJob() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician', { fullName: 'Anna' })
  const job = await createJob(await createCustomer(), { status: 'in_progress' })
  const rate = await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })
  await StockLedger.receive(valve, { quantity: '20', occurredOn: DateTime.now() })
  await Charge.create({
    jobId: job.id,
    kind: 'item',
    itemId: valve.id,
    quantity: '10',
    billQuantity: '10',
    unitPrice: '7.5',
    description: 'Valvola',
  })

  const done = await visitOn(job, anna, 20, 'in_progress')
  await FieldWork.recordHours(
    done,
    { technicianId: anna.id, labourRateId: rate.id, hours: '2' },
    anna
  )
  await FieldWork.recordItem(done, { itemId: valve.id, quantity: '3' }, anna)
  const unused = await FieldWork.recordItem(done, { itemId: valve.id, quantity: '1' }, anna)
  await FieldWork.setStatus(done, 'done', anna, [unused.id])

  const cancelled = await visitOn(job, anna, 21, 'planned')
  await FieldWork.recordItem(cancelled, { itemId: valve.id, quantity: '4' }, anna)
  await Scheduling.cancel(cancelled, office)

  const next = await visitOn(job, anna, 22, 'planned')
  await FieldWork.recordHours(
    next,
    { technicianId: anna.id, labourRateId: rate.id, hours: '3' },
    anna
  )
  return { office, anna, job, rate, valve, done, cancelled, next }
}

/**
 * The Job's recorded quantities by work state as SQL reads them
 * (WORK_STATE_SQL), for the Charges `where` picks.
 */
async function sqlTotals(job: Job, where: Record<string, unknown>): Promise<WorkTotals> {
  const rows = await db
    .from('charges')
    .where('job_id', job.id)
    .where(where)
    .select(db.raw(`${WORK_STATE_SQL('charges')} AS work`))
    .sum('quantity as quantity')
    .groupBy('work')
  const of = (work: string) =>
    new Big(rows.find((row) => row.work === work)?.quantity ?? 0).toString()
  return { planned: of('planned'), done: of('done'), notDone: of('not_done') }
}

test.group('Job page summary (#178)', () => {
  test('Visit progress: done of those not cancelled, and the next one', async ({
    client,
    assert,
  }) => {
    const { office, job } = await longJob()

    const response = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)

    response.assertStatus(200)
    assert.deepEqual(response.inertiaProps.progress, {
      done: 1,
      total: 2,
      cancelled: 1,
      next: { startsAt: '2026-10-22T09:00', endsAt: '2026-10-22T12:00' },
    })
  })

  test('no next Visit on a cancelled Job: its open Visit is frozen', async ({ client, assert }) => {
    const { office, job } = await longJob()
    await Jobs.cancel(job.id)

    const response = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)

    assert.deepEqual(response.inertiaProps.progress, {
      done: 1,
      total: 2,
      cancelled: 1,
      next: null,
    })
  })

  test('hours and Items across the Visits and the Job, by work state, agreeing with SQL', async ({
    client,
    assert,
  }) => {
    const { office, anna, job, rate, valve, done, cancelled, next } = await longJob()

    const response = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)

    const summary = response.inertiaProps.summary as {
      hours: (WorkTotals & {
        key: string
        worker: string
        labourRate: string
        unit: string
        visits: unknown[]
      })[]
      items: (WorkTotals & { itemId: number; item: string; visits: unknown[] })[]
    }
    assert.deepEqual(summary.hours, [
      {
        key: JSON.stringify([anna.id, rate.id]),
        worker: 'Anna',
        labourRate: 'Idraulico',
        unit: 'h',
        planned: '3',
        done: '2',
        notDone: '0',
        visits: [
          { visitId: done.id, planned: '0', done: '2', notDone: '0' },
          { visitId: next.id, planned: '3', done: '0', notDone: '0' },
        ],
      },
    ])
    // The cancelled Visit's valves are not done (#157)
    assert.deepEqual(summary.items, [
      {
        itemId: valve.id,
        item: 'Valvola',
        unit: 'pz',
        planned: '10',
        done: '3',
        notDone: '5',
        visits: [
          { visitId: null, planned: '10', done: '0', notDone: '0' },
          { visitId: done.id, planned: '0', done: '3', notDone: '1' },
          { visitId: cancelled.id, planned: '0', done: '0', notDone: '4' },
        ],
      },
    ])

    const totals = ({ planned, done: used, notDone }: WorkTotals) => ({
      planned,
      done: used,
      notDone,
    })
    assert.deepEqual(
      totals(summary.items[0]),
      await sqlTotals(job, { kind: 'item', item_id: valve.id })
    )
    assert.deepEqual(
      totals(summary.hours[0]),
      await sqlTotals(job, { kind: 'labour', labour_rate_id: rate.id })
    )
  })
})
