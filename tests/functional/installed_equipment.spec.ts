import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import InstalledEquipment from '#models/installed_equipment'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const boilerFields = {
  equipmentType: 'Boiler',
  make: 'Vaillant',
  model: 'ecoTEC plus',
  serialNumber: '21183400100293840',
  installedOn: '2024-10-01',
  maintenanceIntervalMonths: '12',
}

test.group('Installed Equipment', () => {
  test('adds equipment to a Site', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()

    const response = await client
      .post(`/sites/${site.id}/equipment`)
      .form(boilerFields)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', `/sites/${site.id}`)
    const boiler = await InstalledEquipment.firstOrFail()
    assert.equal(boiler.siteId, site.id)
    assert.equal(boiler.installedOn?.toISODate(), '2024-10-01')
    assert.equal(boiler.nextDueOn?.toISODate(), '2025-10-01')
  })

  test('edits equipment, recording a service', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const boiler = await site.related('installedEquipment').create({ equipmentType: 'Boiler' })

    await client
      .put(`/equipment/${boiler.id}`)
      .form({ ...boilerFields, lastServicedOn: '2026-01-15', maintenanceIntervalMonths: '24' })
      .withCsrfToken()
      .loginAs(office)

    await boiler.refresh()
    assert.equal(boiler.make, 'Vaillant')
    assert.equal(boiler.nextDueOn?.toISODate(), '2028-01-15')
  })

  test('an edit keeps a service date a Visit set while the page was open', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const site = await createSite()
    const boiler = await site
      .related('installedEquipment')
      .create({ equipmentType: 'Boiler', lastServicedOn: DateTime.fromISO('2025-03-01') })

    // Loaded with 2025-03-01; a Visit then records a service on 2026-02-10
    await boiler.merge({ lastServicedOn: DateTime.fromISO('2026-02-10') }).save()
    await client
      .put(`/equipment/${boiler.id}`)
      .form({ ...boilerFields, lastServicedOn: '2025-03-01', lastServicedOnWas: '2025-03-01' })
      .withCsrfToken()
      .loginAs(office)
    await boiler.refresh()
    assert.equal(boiler.make, 'Vaillant')
    assert.equal(boiler.lastServicedOn?.toISODate(), '2026-02-10')

    // A date Office changes on purpose is saved, even an earlier one
    await client
      .put(`/equipment/${boiler.id}`)
      .form({ ...boilerFields, lastServicedOn: '2025-12-01', lastServicedOnWas: '2026-02-10' })
      .withCsrfToken()
      .loginAs(office)
    await boiler.refresh()
    assert.equal(boiler.lastServicedOn?.toISODate(), '2025-12-01')

    // And clearing it clears it
    await client
      .put(`/equipment/${boiler.id}`)
      .form({ ...boilerFields, lastServicedOnWas: '2025-12-01' })
      .withCsrfToken()
      .loginAs(office)
    await boiler.refresh()
    assert.isNull(boiler.lastServicedOn)
  })

  test('rejects future dates and a zero interval', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const tomorrow = DateTime.now().plus({ days: 1 }).toISODate()

    const response = await client
      .post(`/sites/${site.id}/equipment`)
      .form({ equipmentType: 'Boiler', installedOn: tomorrow, maintenanceIntervalMonths: '0' })
      .header('referer', `/sites/${site.id}/equipment/create`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), [
      'installedOn',
      'maintenanceIntervalMonths',
    ])
    assert.lengthOf(await InstalledEquipment.all(), 0)
  })

  test('a last service before installation is rejected', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()

    const response = await client
      .post(`/sites/${site.id}/equipment`)
      .form({ ...boilerFields, lastServicedOn: '2024-09-30' })
      .header('referer', `/sites/${site.id}/equipment/create`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['lastServicedOn'])
  })

  test('a last service without an install date is accepted', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()

    await client
      .post(`/sites/${site.id}/equipment`)
      .form({
        equipmentType: 'Boiler',
        lastServicedOn: '2025-03-01',
        maintenanceIntervalMonths: '12',
      })
      .withCsrfToken()
      .loginAs(office)

    const boiler = await InstalledEquipment.firstOrFail()
    assert.equal(boiler.nextDueOn?.toISODate(), '2026-03-01')
  })

  test('clearing fields on edit removes them', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const boiler = await site.related('installedEquipment').create({
      equipmentType: 'Boiler',
      make: 'Vaillant',
      maintenanceIntervalMonths: 12,
      installedOn: DateTime.fromISO('2024-01-01'),
    })

    await client
      .put(`/equipment/${boiler.id}`)
      .form({ equipmentType: 'Boiler', make: '', maintenanceIntervalMonths: '', installedOn: '' })
      .withCsrfToken()
      .loginAs(office)

    await boiler.refresh()
    assert.isNull(boiler.make)
    assert.isNull(boiler.maintenanceIntervalMonths)
    assert.isNull(boiler.installedOn)
  })

  test('the Site history page lists its equipment with the next due date', async ({ client }) => {
    const office = await createUser('office')
    const site = await createSite()
    await site.related('installedEquipment').create({
      equipmentType: 'Boiler',
      make: 'Vaillant',
      installedOn: DateTime.fromISO('2025-05-20'),
      maintenanceIntervalMonths: 12,
    })

    const response = await client.get(`/sites/${site.id}`).withInertia().loginAs(office)

    response.assertInertiaComponent('sites/show')
    response.assertInertiaPropsContains({
      installedEquipment: [{ description: 'Boiler — Vaillant', nextDueOn: '2026-05-20' }],
    })
  })

  test('equipment stays with the Site when its Customers change', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const previousOwner = await createCustomer({ name: 'Previous owner' })
    const newOwner = await createCustomer({ name: 'New owner' })
    await previousOwner.related('sites').attach([site.id])
    const boiler = await site.related('installedEquipment').create({ equipmentType: 'Boiler' })

    await client
      .delete(`/customers/${previousOwner.id}/sites/${site.id}`)
      .withCsrfToken()
      .loginAs(office)
    await client
      .post(`/customers/${newOwner.id}/sites`)
      .form({ siteId: String(site.id) })
      .withCsrfToken()
      .loginAs(office)

    await boiler.refresh()
    assert.equal(boiler.siteId, site.id)
    const response = await client.get(`/sites/${site.id}`).withInertia().loginAs(office)
    response.assertInertiaPropsContains({
      customers: [{ displayName: 'New owner' }],
      installedEquipment: [{ id: boiler.id }],
    })
  })

  test('Technicians can not manage equipment from the office screens', async ({
    client,
    assert,
  }) => {
    const technician = await createUser('technician')
    const site = await createSite()
    const boiler = await site.related('installedEquipment').create({ equipmentType: 'Boiler' })

    const page = await client
      .get(`/sites/${site.id}/equipment/create`)
      .withInertia()
      .loginAs(technician)
    page.assertStatus(403)

    for (const request of [
      client.post(`/sites/${site.id}/equipment`).form(boilerFields),
      client.put(`/equipment/${boiler.id}`).form(boilerFields),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(technician)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }

    await boiler.refresh()
    assert.isNull(boiler.make)
    assert.lengthOf(await InstalledEquipment.all(), 1)
  })
})
