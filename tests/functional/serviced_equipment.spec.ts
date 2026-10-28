import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import InstalledEquipment from '#models/installed_equipment'
import Visit from '#models/visit'
import VisitItem from '#models/visit_item'
import FieldWork from '#services/field_work'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

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
  test('an installed Item can go onto equipment already at the Site', async ({
    client,
    assert,
  }) => {
    const { anna, visit, boiler, item } = await setup()

    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({
        itemId: String(item.id),
        quantity: '1',
        installed: 'true',
        equipmentId: String(boiler.id),
        serialNumber: 'SN-9',
      })
      .withCsrfToken()
      .loginAs(anna)

    await boiler.refresh()
    assert.equal(boiler.itemId, item.id)
    assert.equal(boiler.serialNumber, 'SN-9')
    assert.lengthOf(await InstalledEquipment.query().where('siteId', boiler.siteId), 1)

    // Removing the line leaves equipment it didn't create
    const line = await VisitItem.findByOrFail('visitId', visit.id)
    await client.delete(`/visit-items/${line.id}`).withCsrfToken().loginAs(anna)
    assert.isNotNull(await InstalledEquipment.find(boiler.id))
  })

  test('new equipment gets its type, make and model', async ({ client, assert }) => {
    const { anna, visit, item, site } = await setup()

    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({
        itemId: String(item.id),
        quantity: '1',
        installed: 'true',
        equipmentType: 'Caldaia murale',
        make: 'Vaillant',
        model: 'ecoTEC',
      })
      .withCsrfToken()
      .loginAs(anna)

    const created = await InstalledEquipment.query()
      .where('siteId', site.id)
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.deepEqual(
      [created.equipmentType, created.make, created.model, created.maintenanceIntervalMonths],
      ['Caldaia murale', 'Vaillant', 'ecoTEC', 24]
    )
  })

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
    assert.lengthOf(await VisitItem.all(), 0)
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
})
