import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { ApiClient } from '@japa/api-client'
import Charge from '#models/charge'
import InstalledEquipment from '#models/installed_equipment'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import Visit from '#models/visit'
import type User from '#models/user'
import FieldWork from '#services/field_work'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

function post(client: ApiClient, user: User, url: string, form: Record<string, unknown> = {}) {
  return client
    .post(url)
    .form(form)
    .header('referer', '/')
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

/**
 * A Job in progress at a Site with a Visit planned at `startsAt` for Anna,
 * where she recorded a boiler from stock, a new Equipment one, and
 * serviced the Site's old boiler.
 */
async function plannedVisit(startsAt: DateTime) {
  await completeCompany()
  const anna = await createUser('technician')
  const site = await createSite()
  const job = await createJob(await createCustomer(), { status: 'in_progress', siteId: site.id })
  const visit = await Visit.create({
    jobId: job.id,
    startsAt,
    endsAt: startsAt.plus({ hours: 2 }),
    status: 'planned',
  })
  await visit.related('technicians').attach([anna.id])
  await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
  const item = await createItem({ description: 'Caldaia 25 kW', resalePrice: '1200' })
  // Equipment: done, it is installed at the Site (#176)
  const boiler = await createItem({ description: 'Caldaia 30 kW', equipment: true })
  for (const stocked of [item, boiler]) {
    await StockLedger.receive(stocked, {
      quantity: '5',
      occurredOn: DateTime.fromISO('2020-01-01'),
    })
  }
  const old = await InstalledEquipment.create({
    siteId: site.id,
    equipmentType: 'Caldaia',
    installedOn: DateTime.fromISO('2020-01-10'),
  })
  await FieldWork.recordItem(visit, { itemId: item.id, quantity: '1' })
  await FieldWork.recordItem(visit, {
    itemId: boiler.id,
    quantity: '1',
    equipmentType: 'Caldaia murale',
  })
  await FieldWork.setServiced(visit, [old.id])
  return { anna, job, visit, item, old }
}

/**
 * The days the Visit's work was dated by: its two Items' usage, the serviced
 * boiler's last service and the new boiler's installation.
 */
async function workDates(old: InstalledEquipment) {
  const usages = await StockMovement.query().where('kind', 'usage')
  await old.refresh()
  const installed = await InstalledEquipment.query().whereNot('id', old.id).firstOrFail()
  return {
    usages: usages.map((usage) => usage.occurredOn.toISODate()),
    serviced: old.lastServicedOn?.toISODate(),
    installed: installed.installedOn?.toISODate(),
  }
}

const today = () => DateTime.now().toISODate()!

test.group('Visit work day and times (#174)', () => {
  test('a Technician marks it in progress early and closes it: work dated today', async ({
    client,
    assert,
  }) => {
    // Planned for tomorrow morning, done today
    const tomorrow = DateTime.now().plus({ days: 1 }).set({ hour: 9, minute: 0 })
    const { anna, visit, old } = await plannedVisit(tomorrow)

    const start = await post(client, anna, `/my-visits/${visit.id}/status`, {
      status: 'in_progress',
    })
    start.assertFlashMissing('error')
    await visit.refresh()
    assert.equal(visit.status, 'in_progress')
    assert.equal(visit.startedById, anna.id)
    assert.isNotNull(visit.startedAt)
    assert.isNull(visit.closedAt)

    const close = await post(client, anna, `/my-visits/${visit.id}/status`, { status: 'done' })
    close.assertFlashMissing('error')
    await visit.refresh()
    assert.equal(visit.status, 'done')
    assert.equal(visit.closedById, anna.id)
    assert.isNotNull(visit.closedAt)
    assert.isTrue(visit.closedAt! >= visit.startedAt!)
    assert.deepEqual(await workDates(old), {
      usages: [today(), today()],
      serviced: today(),
      installed: today(),
    })

    // Shown on the field page and on Office's
    const office = await createUser('office')
    for (const [user, url] of [
      [anna, `/my-visits/${visit.id}`],
      [office, `/visits/${visit.id}/edit`],
    ] as const) {
      const page = await client.get(url).withInertia().loginAs(user)
      page.assertInertiaPropsContains({
        visit: {
          started: { at: visit.startedAt!.toISO(), by: anna.fullName },
          closed: { at: visit.closedAt!.toISO(), by: anna.fullName },
        },
      })
    }
  })

  test('a planned Visit still to come can not be closed, by a Technician or by Office', async ({
    client,
    assert,
  }) => {
    const soon = DateTime.now().plus({ minutes: 5 })
    const { anna, job, visit, item } = await plannedVisit(soon)

    for (const status of ['done', 'needs_return']) {
      const response = await post(client, anna, `/my-visits/${visit.id}/status`, { status })
      response.assertFlashMessage('error', it('flash.fieldWorkRefused.notStarted'))
    }

    const office = await createUser('office')
    await post(client, office, `/jobs/${job.id}/cancel`)
    const response = await post(client, office, `/visits/${visit.id}/done`)
    response.assertFlashMessage('error', it('flash.fieldWorkRefused.notStarted'))

    await visit.refresh()
    assert.equal(visit.status, 'planned')
    assert.isNull(visit.closedAt)
    assert.isNull(visit.closedById)
    assert.equal(await StockLedger.levelOf(item), '5.000')
  })

  test('closed late without being marked in progress: work dated on its planned day', async ({
    client,
    assert,
  }) => {
    const yesterday = DateTime.now().minus({ days: 1 }).set({ hour: 9, minute: 0 })
    const { anna, visit, old } = await plannedVisit(yesterday)

    const close = await post(client, anna, `/my-visits/${visit.id}/status`, {
      status: 'needs_return',
    })
    close.assertFlashMissing('error')
    await visit.refresh()
    assert.equal(visit.status, 'needs_return')
    assert.isNull(visit.startedAt)
    assert.isNull(visit.startedById)
    assert.equal(visit.closedById, anna.id)
    assert.equal(visit.closedAt!.toISODate(), today())
    const day = yesterday.toISODate()
    assert.deepEqual(await workDates(old), { usages: [day, day], serviced: day, installed: day })

    const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    page.assertInertiaPropsContains({ visit: { started: null } })
  })

  test('marked in progress on an earlier day: work dated on the day it started', async ({
    client,
    assert,
  }) => {
    const twoDaysAgo = DateTime.now().minus({ days: 2 }).set({ hour: 9, minute: 0 })
    const { anna, visit, old } = await plannedVisit(twoDaysAgo)
    const started = DateTime.now().minus({ days: 1 })
    await visit.merge({ status: 'in_progress', startedAt: started, startedById: anna.id }).save()

    // Marked in progress again is not a new start: it keeps the first one
    await post(client, anna, `/my-visits/${visit.id}/status`, { status: 'in_progress' })
    await post(client, anna, `/my-visits/${visit.id}/status`, { status: 'done' })

    await visit.refresh()
    assert.equal(visit.status, 'done')
    assert.equal(visit.startedAt!.toISO(), started.toISO())
    const day = started.toISODate()
    assert.deepEqual(await workDates(old), { usages: [day, day], serviced: day, installed: day })
  })

  test('Office closes an in-progress Visit on a cancelled Job before its start', async ({
    client,
    assert,
  }) => {
    const tomorrow = DateTime.now().plus({ days: 1 }).set({ hour: 9, minute: 0 })
    const { anna, job, visit, old } = await plannedVisit(tomorrow)
    await FieldWork.setStatus(visit, 'in_progress', anna)
    const office = await createUser('office')
    await post(client, office, `/jobs/${job.id}/cancel`)

    const done = await post(client, office, `/visits/${visit.id}/done`)
    done.assertFlashMessage('success', it('flash.visitMarkedDone'))
    await visit.refresh()
    assert.equal(visit.status, 'done')
    assert.equal(visit.startedById, anna.id)
    assert.equal(visit.closedById, office.id)
    assert.deepEqual(await workDates(old), {
      usages: [today(), today()],
      serviced: today(),
      installed: today(),
    })
  })

  test('back to planned clears the start; cancelling sets nothing, restoring clears', async ({
    client,
    assert,
  }) => {
    const tomorrow = DateTime.now().plus({ days: 1 }).set({ hour: 9, minute: 0 })
    const { anna, visit } = await plannedVisit(tomorrow)
    const office = await createUser('office')

    await post(client, anna, `/my-visits/${visit.id}/status`, { status: 'in_progress' })
    await post(client, anna, `/my-visits/${visit.id}/status`, { status: 'planned' })
    await visit.refresh()
    assert.isNull(visit.startedAt)
    assert.isNull(visit.startedById)
    // Planned again with a start to come: refused as before
    const close = await post(client, anna, `/my-visits/${visit.id}/status`, { status: 'done' })
    close.assertFlashMessage('error', it('flash.fieldWorkRefused.notStarted'))

    await post(client, anna, `/my-visits/${visit.id}/status`, { status: 'in_progress' })
    await post(client, office, `/visits/${visit.id}/cancel`)
    await visit.refresh()
    assert.equal(visit.status, 'cancelled')
    // Cancelling keeps when it started and sets no close
    assert.equal(visit.startedById, anna.id)
    assert.isNull(visit.closedAt)

    await post(client, office, `/visits/${visit.id}/restore`)
    await visit.refresh()
    assert.equal(visit.status, 'planned')
    assert.isNull(visit.startedAt)
    assert.isNull(visit.startedById)
    assert.isNull(visit.closedAt)
    assert.isNull(visit.closedById)
  })

  test('Office marking done later dates the usage by the work day; not done is dated today', async ({
    client,
    assert,
  }) => {
    const threeDaysAgo = DateTime.now().minus({ days: 3 }).set({ hour: 9, minute: 0 })
    const { anna, visit, item, old } = await plannedVisit(threeDaysAgo)
    const started = DateTime.now().minus({ days: 2 })
    await visit.merge({ status: 'in_progress', startedAt: started, startedById: anna.id }).save()
    // Closed with the boiler from stock unticked: left not done
    const [unused] = await Charge.query().where('visitId', visit.id).orderBy('id')
    await FieldWork.setStatus(visit, 'done', anna, [unused.id])
    const office = await createUser('office')

    const done = await post(client, office, `/charges/${unused.id}/done`)
    done.assertFlashMissing('error')
    await unused.refresh()
    const usage = await StockMovement.findOrFail(unused.stockMovementId)
    assert.equal(usage.kind, 'usage')
    assert.equal(usage.occurredOn.toISODate(), started.toISODate())
    const { usages } = await workDates(old)
    assert.deepEqual(usages, [started.toISODate(), started.toISODate()])

    // Not done again: back on stock the day Office corrects it
    await post(client, office, `/charges/${unused.id}/not-done`)
    const adjustment = await StockMovement.query().where('kind', 'adjustment').firstOrFail()
    assert.equal(adjustment.occurredOn.toISODate(), today())
    // (the new boiler is another Item, still off stock)
    assert.equal(await StockLedger.levelOf(item), '5.000')
  })
})
