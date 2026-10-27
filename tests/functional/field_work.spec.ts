import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Visit from '#models/visit'
import VisitItem from '#models/visit_item'
import LabourRate from '#models/labour_rate'
import InstalledEquipment from '#models/installed_equipment'
import StockMovement from '#models/stock_movement'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

async function setup() {
  const anna = await createUser('technician')
  const bruno = await createUser('technician')
  const site = await createSite()
  const job = await createJob(await createCustomer(), {
    kind: 'time_and_materials',
    status: 'in_progress',
    siteId: site.id,
  })
  const start = DateTime.now().plus({ hours: 1 })
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 2 }),
    status: 'planned',
  })
  await visit.related('technicians').attach([anna.id, bruno.id])
  const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
  const item = await createItem({
    code: 'CALD-25',
    description: 'Caldaia 25 kW',
    resalePrice: '1200',
    maintenanceIntervalMonths: 12,
  })
  return { anna, bruno, site, job, visit, rate, item }
}

test.group('Field work', () => {
  test('records hours for the team at a Labour Rate', async ({ client, assert }) => {
    const { anna, bruno, visit, rate } = await setup()

    for (const [technician, hours] of [
      [anna, '2,5'],
      [bruno, '1'],
    ] as const) {
      await client
        .post(`/my-visits/${visit.id}/hours`)
        .form({ technicianId: String(technician.id), labourRateId: String(rate.id), hours })
        .withCsrfToken()
        .loginAs(anna)
    }

    await visit.load('hours')
    assert.sameMembers(
      visit.hours.map((hour) => `${hour.userId}:${hour.hours}`),
      [`${anna.id}:2.500`, `${bruno.id}:1.000`]
    )
  })

  test('hours only for Technicians on the Visit, and never zero', async ({ client, assert }) => {
    const { anna, visit, rate } = await setup()
    const outsider = await createUser('technician')

    const notOnVisit = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(outsider.id), labourRateId: String(rate.id), hours: '1' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    notOnVisit.assertFlashMessage('error', it('flash.fieldWorkRefused.notOnVisit'))

    const zero = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '0' })
      .header('referer', `/my-visits/${visit.id}`)
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    assert.properties(zero.flashMessage('inputErrorsBag'), ['hours'])

    await visit.load('hours')
    assert.lengthOf(visit.hours, 0)
  })

  test('an installed Item becomes Installed Equipment at the Site', async ({ client, assert }) => {
    const { anna, site, visit, item } = await setup()

    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '1', installed: 'true', serialNumber: 'SN-777' })
      .withCsrfToken()
      .loginAs(anna)

    const line = await VisitItem.firstOrFail()
    const equipment = await InstalledEquipment.findOrFail(line.installedEquipmentId!)
    assert.equal(equipment.siteId, site.id)
    assert.equal(equipment.itemId, item.id)
    assert.equal(equipment.serialNumber, 'SN-777')
    assert.equal(equipment.maintenanceIntervalMonths, 12)
    assert.equal(equipment.installedOn?.toISODate(), visit.startsAt.toISODate())

    // Removing the line removes the equipment it created
    await client.delete(`/visit-items/${line.id}`).withCsrfToken().loginAs(anna)
    assert.isNull(await InstalledEquipment.find(equipment.id))
  })

  test('installing needs a Site on the Job', async ({ client, assert }) => {
    const { anna, job, visit, item } = await setup()
    job.siteId = null
    await job.save()

    const response = await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '1', installed: 'true' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.fieldWorkRefused.noSite'))
    assert.lengthOf(await VisitItem.all(), 0)
  })

  test('marking the Visit done takes the Items off stock once, then locks it', async ({
    client,
    assert,
  }) => {
    const { anna, visit, item } = await setup()
    await StockLedger.receive(item, { quantity: '5', occurredOn: DateTime.now() })
    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '2' })
      .withCsrfToken()
      .loginAs(anna)

    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .withCsrfToken()
      .loginAs(anna)

    await visit.refresh()
    assert.equal(visit.status, 'done')
    assert.equal(await StockLedger.levelOf(item), '3.000')
    const usage = await StockMovement.query().where('kind', 'usage').firstOrFail()
    assert.equal(usage.quantity, '-2.000')
    const line = await VisitItem.firstOrFail()
    assert.equal(line.stockMovementId, usage.id)

    // Done is final: no status change, no new lines, no double deduction
    const reopen = await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'planned' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    reopen.assertFlashMessage('error', it('flash.visitDone'))
    const more = await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '1' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    more.assertFlashMessage('error', it('flash.fieldWorkRefused.done'))
    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .withCsrfToken()
      .loginAs(anna)
    assert.equal(await StockLedger.levelOf(item), '3.000')
  })

  test('needing another visit also takes the Items off stock and closes the Visit', async ({
    client,
    assert,
  }) => {
    const { anna, visit, item, job, rate } = await setup()
    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '2' })
      .withCsrfToken()
      .loginAs(anna)

    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'needs_return' })
      .withCsrfToken()
      .loginAs(anna)

    assert.equal(await StockLedger.levelOf(item), '-2.000')
    const usage = await StockMovement.query().where('kind', 'usage').firstOrFail()
    assert.equal(usage.reference, job.number)
    assert.equal(usage.occurredOn.toISODate(), visit.startsAt.toISODate())
    const more = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '1' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    more.assertFlashMessage('error', it('flash.fieldWorkRefused.done'))
  })

  test('recorded work keeps its price when the rate changes later', async ({ client }) => {
    const { anna, job, visit, rate } = await setup()
    const admin = await createUser('admin')
    await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '2' })
      .withCsrfToken()
      .loginAs(anna)

    await client
      .put(`/settings/rates/${rate.id}`)
      .form({ name: rate.name, hourlyPrice: '45' })
      .withCsrfToken()
      .loginAs(admin)

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(admin)
    page.assertInertiaPropsContains({ timeAndMaterials: { total: '80.00' } })
  })

  test("Technicians not on the Visit can't record or remove anything", async ({
    client,
    assert,
  }) => {
    const { anna, visit, rate, item } = await setup()
    const outsider = await createUser('technician')
    const hour = await visit
      .related('hours')
      .create({ userId: anna.id, labourRateId: rate.id, hours: '1', unitPrice: '40' })

    for (const request of [
      client
        .post(`/my-visits/${visit.id}/hours`)
        .form({ technicianId: String(outsider.id), labourRateId: String(rate.id), hours: '1' }),
      client.post(`/my-visits/${visit.id}/items`).form({ itemId: String(item.id), quantity: '1' }),
      client.delete(`/visit-hours/${hour.id}`),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(outsider)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    await visit.load('hours')
    assert.lengthOf(visit.hours, 1)
  })

  test('Office sees the running total and Work Complete; Technicians see no prices', async ({
    client,
    assert,
  }) => {
    const { anna, job, visit, rate, item } = await setup()
    const office = await createUser('office')
    await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '2,5' })
      .withCsrfToken()
      .loginAs(anna)
    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '1' })
      .withCsrfToken()
      .loginAs(anna)

    const technicianView = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    assert.notMatch(JSON.stringify(technicianView.inertiaProps), /price|cost|total|1200|"40/i)

    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .withCsrfToken()
      .loginAs(anna)

    // 2.5 h × 40 + 1 × 1200 = 1300
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      timeAndMaterials: { total: '1300.00' },
      job: { status: 'work_complete' },
    })

    const titles = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number }[]).map((row) => row.id)
    }
    assert.deepEqual(await titles('work_complete'), [job.id])
    assert.deepEqual(await titles('in_progress'), [])

    const technicianJob = await client.get(`/jobs/${job.id}`).withInertia().loginAs(anna)
    technicianJob.assertStatus(403)
  })
})
