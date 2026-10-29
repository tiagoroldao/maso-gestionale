import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import InstalledEquipment from '#models/installed_equipment'
import Visit from '#models/visit'
import Charge from '#models/charge'
import FieldWork from '#services/field_work'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

async function setup() {
  const anna = await createUser('technician')
  const site = await createSite()
  const job = await createJob(await createCustomer(), { siteId: site.id, status: 'in_progress' })
  const start = DateTime.fromISO('2026-10-20T09:00')
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 2 }),
    status: 'planned',
  })
  await visit.related('technicians').attach([anna.id])
  const boiler = await InstalledEquipment.create({
    siteId: site.id,
    equipmentType: 'Caldaia',
    installedOn: DateTime.fromISO('2020-01-10'),
    maintenanceIntervalMonths: 12,
  })
  const item = await createItem({
    description: 'Caldaia a condensazione 25 kW',
    maintenanceIntervalMonths: 24,
  })
  return { anna, site, visit, boiler, item }
}

test.group('Installing onto Site equipment', () => {
  test("equipment at another Site can't be picked", async ({ client, assert }) => {
    const { anna, visit, item } = await setup()
    const otherSite = await createSite()
    const elsewhere = await InstalledEquipment.create({
      siteId: otherSite.id,
      equipmentType: 'Altro',
    })

    const response = await client
      .post(`/my-visits/${visit.id}/items`)
      .form({
        itemId: String(item.id),
        quantity: '1',
        installed: 'true',
        equipmentId: String(elsewhere.id),
      })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.fieldWorkRefused.notAtSite'))
    assert.lengthOf(await Charge.all(), 0)
  })
})

test.group('Servicing equipment', () => {
  test('closing the Visit dates the service of the equipment it serviced', async ({
    client,
    assert,
  }) => {
    const { anna, visit, boiler } = await setup()

    await client
      .post(`/my-visits/${visit.id}/serviced`)
      .json({ equipmentIds: [boiler.id] })
      .withCsrfToken()
      .loginAs(anna)
    const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    page.assertInertiaPropsContains({ servicedIds: [boiler.id] })
    await FieldWork.setStatus(visit, 'done', anna)

    await boiler.refresh()
    assert.equal(boiler.lastServicedOn?.toISODate(), '2026-10-20')
    assert.equal(boiler.nextDueOn?.toISODate(), '2027-10-20')
  })

  test('an older Visit never moves a later service date back', async ({ assert }) => {
    const { anna, visit, boiler } = await setup()
    boiler.lastServicedOn = DateTime.fromISO('2026-10-25')
    await boiler.save()

    await FieldWork.setServiced(visit, [boiler.id])
    await FieldWork.setStatus(visit, 'done', anna)

    await boiler.refresh()
    assert.equal(boiler.lastServicedOn?.toISODate(), '2026-10-25')
  })

  test('an Office edit open while the Visit closed keeps its service date', async ({
    client,
    assert,
  }) => {
    const { anna, visit, boiler } = await setup()
    const office = await createUser('office')
    // Office opens the edit page (no service date yet); the Visit closes
    await FieldWork.setServiced(visit, [boiler.id])
    await FieldWork.setStatus(visit, 'done', anna)

    await client
      .put(`/equipment/${boiler.id}`)
      .form({ equipmentType: 'Caldaia', make: 'Vaillant', installedOn: '2020-01-10' })
      .withCsrfToken()
      .loginAs(office)

    await boiler.refresh()
    assert.equal(boiler.make, 'Vaillant')
    assert.equal(boiler.lastServicedOn?.toISODate(), '2026-10-20')
  })

  test('Office changing the date as a Visit closes is refused, not overwritten', async ({
    client,
    assert,
  }) => {
    const { anna, visit, boiler } = await setup()
    const office = await createUser('office')
    await FieldWork.setServiced(visit, [boiler.id])
    await FieldWork.setStatus(visit, 'done', anna)

    const response = await client
      .put(`/equipment/${boiler.id}`)
      .form({
        equipmentType: 'Caldaia',
        make: 'Vaillant',
        installedOn: '2020-01-10',
        lastServicedOn: '2025-01-01',
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.serviceDateChanged'))
    await boiler.refresh()
    assert.isNull(boiler.make)
    assert.equal(boiler.lastServicedOn?.toISODate(), '2026-10-20')
  })

  test("serviced equipment must be at the Visit's Site", async ({ client }) => {
    const { anna, visit } = await setup()
    const otherSite = await createSite()
    const elsewhere = await InstalledEquipment.create({
      siteId: otherSite.id,
      equipmentType: 'Altro',
    })

    const response = await client
      .post(`/my-visits/${visit.id}/serviced`)
      .json({ equipmentIds: [elsewhere.id] })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.fieldWorkRefused.notAtSite'))
  })

  test('the next due date in SQL matches the model', async ({ assert }) => {
    const { site } = await setup()
    await InstalledEquipment.createMany([
      {
        siteId: site.id,
        equipmentType: 'A',
        installedOn: DateTime.fromISO('2024-01-31'),
        maintenanceIntervalMonths: 1,
      },
      {
        siteId: site.id,
        equipmentType: 'B',
        installedOn: DateTime.fromISO('2023-05-01'),
        lastServicedOn: DateTime.fromISO('2025-06-15'),
        maintenanceIntervalMonths: 6,
      },
      { siteId: site.id, equipmentType: 'C', installedOn: DateTime.fromISO('2023-05-01') },
    ])

    const rows = await db
      .from('installed_equipment')
      .where('site_id', site.id)
      .select('id', db.raw(`to_char(${InstalledEquipment.NEXT_DUE_SQL}, 'YYYY-MM-DD') as next_due`))
    const models = await InstalledEquipment.query().where('siteId', site.id)
    for (const model of models) {
      const row = rows.find((r) => r.id === model.id)
      assert.equal(row.next_due, model.nextDueOn?.toISODate() ?? null, model.equipmentType)
    }
  })

  test('serviced equipment: outsiders, closed Visits and cancelled Jobs are refused', async ({
    client,
    assert,
  }) => {
    const { anna, visit, boiler } = await setup()
    const outsider = await createUser('technician')
    const denied = await client
      .post(`/my-visits/${visit.id}/serviced`)
      .json({ equipmentIds: [boiler.id] })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(outsider)
      .redirects(0)
    denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))

    await FieldWork.setStatus(visit, 'done', anna)
    const closed = await client
      .post(`/my-visits/${visit.id}/serviced`)
      .json({ equipmentIds: [boiler.id] })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    closed.assertFlashMessage('error', it('flash.fieldWorkRefused.done'))

    const other = await setup()
    await client
      .post(`/jobs/${other.visit.jobId}/cancel`)
      .withCsrfToken()
      .loginAs(await createUser('office'))
    const cancelled = await client
      .post(`/my-visits/${other.visit.id}/serviced`)
      .json({ equipmentIds: [other.boiler.id] })
      .withCsrfToken()
      .loginAs(other.anna)
      .redirects(0)
    cancelled.assertFlashMessage('error', it('flash.fieldWorkRefused.cancelled'))
    assert.lengthOf(await db.from('visit_serviced_equipment'), 0)
  })
})
