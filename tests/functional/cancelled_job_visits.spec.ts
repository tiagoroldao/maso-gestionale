import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { ApiClient } from '@japa/api-client'
import Charge from '#models/charge'
import InstalledEquipment from '#models/installed_equipment'
import Invoice from '#models/invoice'
import type Job from '#models/job'
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
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

function post(client: ApiClient, user: User, url: string) {
  return client.post(url).header('referer', '/').withCsrfToken().loginAs(user).redirects(0)
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
 * A Job in progress at a Site, with a Visit where Anna recorded 2 hours and
 * 2 boilers and serviced the Site's old boiler, but never closed it.
 */
async function workedVisit() {
  await completeCompany()
  const anna = await createUser('technician')
  const site = await createSite()
  const job = await createJob(await createCustomer(), { status: 'in_progress', siteId: site.id })
  const visit = await visitOf(job, { status: 'in_progress' })
  await visit.related('technicians').attach([anna.id])
  const rate = await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
  const item = await createItem({ description: 'Caldaia 25 kW', resalePrice: '1200' })
  await StockLedger.receive(item, { quantity: '5', occurredOn: DateTime.now() })
  const boiler = await InstalledEquipment.create({
    siteId: site.id,
    equipmentType: 'Caldaia',
    installedOn: DateTime.fromISO('2020-01-10'),
  })
  await FieldWork.recordHours(visit, { technicianId: anna.id, labourRateId: rate.id, hours: '2' })
  await FieldWork.recordItem(visit, { itemId: item.id, quantity: '2' })
  await FieldWork.setServiced(visit, [boiler.id])
  return { anna, job, visit, item, boiler }
}

test.group('Visits left open on a cancelled Job (#153)', () => {
  test('{$self} marks one done: Items off stock, equipment serviced, Charges billable')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { job, visit, item, boiler } = await workedVisit()
      await post(client, user, `/jobs/${job.id}/cancel`)
      await job.refresh()
      assert.equal(job.status, 'cancelled')

      // Frozen: offered to Office, nothing to invoice yet (the Visit is open)
      const before = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
      before.assertInertiaPropsContains({
        canInvoice: false,
        visits: [{ id: visit.id, closableByOffice: true }],
      })
      const edit = await client.get(`/visits/${visit.id}/edit`).withInertia().loginAs(user)
      edit.assertInertiaPropsContains({ visit: { editable: false, closableByOffice: true } })

      const response = await post(client, user, `/visits/${visit.id}/done`)
      response.assertHeader('location', `/jobs/${job.id}`)
      response.assertFlashMessage('success', it('flash.visitMarkedDone'))

      await visit.refresh()
      assert.equal(visit.status, 'done')
      await job.refresh()
      assert.equal(job.status, 'cancelled')
      assert.equal(await StockLedger.levelOf(item), '3.000')
      const usage = await StockMovement.query().where('kind', 'usage').firstOrFail()
      assert.equal(usage.quantity, '-2.000')
      assert.equal(usage.reference, job.number)
      assert.equal(usage.createdBy, user.id)
      const line = await Charge.query().where('visitId', visit.id).where('kind', 'item').first()
      assert.equal(line!.stockMovementId, usage.id)
      await boiler.refresh()
      assert.equal(boiler.lastServicedOn!.toISODate(), '2026-10-03')

      const after = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
      after.assertInertiaPropsContains({
        canInvoice: true,
        visits: [{ id: visit.id, closableByOffice: false }],
      })
      const drafted = await post(client, user, `/jobs/${job.id}/invoices`)
      drafted.assertFlashMessage('success', it('flash.invoiceCreated'))
      const invoice = await Invoice.query().where('jobId', job.id).preload('lines').firstOrFail()
      // 2 h × 40 and 2 × 1200
      assert.sameMembers(
        invoice.lines.map((l) => l.quantity),
        ['2.000', '2.000']
      )
      assert.sameMembers(
        invoice.lines.map((l) => l.unitPrice),
        ['40.0000', '1200.0000']
      )
    })

  test('Technicians and the Superuser can not mark it done; the Technician route stays refused', async ({
    client,
    assert,
  }) => {
    const { anna, job, visit, item } = await workedVisit()
    await post(client, await createUser('office'), `/jobs/${job.id}/cancel`)

    for (const role of ['technician', 'superuser'] as const) {
      const response = await post(client, await createUser(role), `/visits/${visit.id}/done`)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    // Anna is on the Visit: the office route is still not hers
    const own = await post(client, anna, `/visits/${visit.id}/done`)
    own.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    // Nor does the field route close it on a cancelled Job
    const field = await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    field.assertFlashMessage('error', it('flash.fieldWorkRefused.cancelled'))

    await visit.refresh()
    assert.equal(visit.status, 'in_progress')
    assert.equal(await StockLedger.levelOf(item), '5.000')
  })

  test('refused for a Visit already closed, and on a Job that is not cancelled', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const cancelled = await createJob(await createCustomer(), { status: 'cancelled' })
    const returning = await visitOf(cancelled, { status: 'needs_return' })
    const done = await visitOf(cancelled, { status: 'done' }, 1)
    const active = await createJob(await createCustomer(), { status: 'in_progress' })
    const working = await visitOf(active)
    const closed = await createJob(await createCustomer(), { status: 'closed' })
    const frozen = await visitOf(closed)

    for (const [visit, reason, status] of [
      [returning, 'done', 'needs_return'],
      [done, 'done', 'done'],
      [working, 'notCancelled', 'planned'],
      [frozen, 'closed', 'planned'],
    ] as const) {
      const response = await post(client, office, `/visits/${visit.id}/done`)
      response.assertFlashMessage('error', it(`flash.fieldWorkRefused.${reason}`))
      await visit.refresh()
      assert.equal(visit.status, status)
    }
    assert.lengthOf(await StockMovement.all(), 0)

    // Offered only on the cancelled Job's open Visits, on the Job page or the Visit's
    for (const job of [cancelled, active, closed]) {
      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
      for (const row of page.inertiaProps.visits as { closableByOffice: boolean }[]) {
        assert.isFalse(row.closableByOffice)
      }
    }
    for (const visit of [returning, working, frozen]) {
      const page = await client.get(`/visits/${visit.id}/edit`).withInertia().loginAs(office)
      page.assertInertiaPropsContains({ visit: { closableByOffice: false } })
    }
  })

  test('refused for a planned Visit still to come: nothing leaves stock (#174)', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { job, visit, item } = await workedVisit()
    await post(client, office, `/jobs/${job.id}/cancel`)
    const startsAt = DateTime.now().plus({ minutes: 5 })
    await visit.merge({ status: 'planned', startsAt, endsAt: startsAt.plus({ hours: 2 }) }).save()

    const response = await post(client, office, `/visits/${visit.id}/done`)
    response.assertFlashMessage('error', it('flash.fieldWorkRefused.notStarted'))
    await visit.refresh()
    assert.equal(visit.status, 'planned')
    assert.equal(await StockLedger.levelOf(item), '5.000')
    assert.lengthOf(await StockMovement.query().where('kind', 'usage'), 0)
    const charges = await Charge.query().where('visitId', visit.id).preload('events')
    assert.isTrue(charges.every((charge) => charge.workState === 'planned'))

    // Once it has started, it is marked done
    const started = DateTime.now().minus({ minutes: 5 })
    await visit.merge({ startsAt: started, endsAt: started.plus({ hours: 2 }) }).save()
    const done = await post(client, office, `/visits/${visit.id}/done`)
    done.assertFlashMessage('success', it('flash.visitMarkedDone'))
    assert.equal(await StockLedger.levelOf(item), '3.000')
  })

  test('cancelling with open Visits warns and never refuses', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(job, { status: 'done' })
    await visitOf(job, { status: 'needs_return' }, 1)
    await visitOf(job, { status: 'in_progress' }, 2)
    await visitOf(job, { survey: true }, 3)

    const response = await post(client, office, `/jobs/${job.id}/cancel`)
    response.assertFlashMessage(
      'warning',
      it('flash.jobCancelledWithOpenVisits', { number: job.number, count: 2 })
    )
    await job.refresh()
    assert.equal(job.status, 'cancelled')
    const cancelledAt = job.cancelledAt!.toISO()

    // Cancelled again (a second tab): the same warning, the first date kept
    const again = await post(client, office, `/jobs/${job.id}/cancel`)
    again.assertFlashMessage(
      'warning',
      it('flash.jobCancelledWithOpenVisits', { number: job.number, count: 2 })
    )
    await job.refresh()
    assert.equal(job.cancelledAt!.toISO(), cancelledAt)

    // Without open Visits, a plain confirmation
    const quiet = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(quiet, { status: 'done' })
    const plain = await post(client, office, `/jobs/${quiet.id}/cancel`)
    plain.assertFlashMessage('success', it('flash.jobCancelled', { number: quiet.number }))
  })
})
