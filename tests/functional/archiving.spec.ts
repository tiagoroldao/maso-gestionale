import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import InstalledEquipment from '#models/installed_equipment'
import Visit from '#models/visit'
import Jobs from '#services/jobs'
import { ArchivedRecordError } from '#services/archiving'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

test.group('Archiving Customers and Sites', () => {
  test('a Job is never opened on an archived Customer or Site, even in a race', async ({
    assert,
  }) => {
    const customer = await createCustomer()
    await customer.merge({ archivedAt: DateTime.now() }).save()

    // The validator already passed: the service still checks under a lock
    await assert.rejects(
      () =>
        Jobs.create({
          customerId: customer.id,
          kind: 'quoted',
          workCategory: 'repair',
          title: 'X',
        }),
      ArchivedRecordError
    )
  })

  test("a new Site can't be linked to an archived Customer", async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    await customer.merge({ archivedAt: DateTime.now() }).save()

    const response = await client
      .post('/sites')
      .form({
        street: 'Via Roma',
        postalCode: '20121',
        city: 'Milano',
        province: 'MI',
        customerId: String(customer.id),
      })
      .header('referer', '/sites/create')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['customerId'])
  })

  test('an archived Customer leaves the list and pickers, and comes back on restore', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer({ name: 'Bar Vecchio' })
    await createCustomer({ name: 'Bar Nuovo' })

    const archived = await client
      .post(`/customers/${customer.id}/archive`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    archived.assertFlashMessage('success', it('flash.customerArchived'))

    const list = await client.get('/customers').withInertia().loginAs(office)
    const names = (list.inertiaProps.customers as { displayName: string }[]).map(
      (c) => c.displayName
    )
    assert.deepEqual(names, ['Bar Nuovo'])
    const archivedList = await client
      .get('/customers')
      .qs({ archived: 'true' })
      .withInertia()
      .loginAs(office)
    assert.deepEqual(
      (archivedList.inertiaProps.customers as { id: number }[]).map((c) => c.id),
      [customer.id]
    )
    const picker = await client.get('/customers/search').qs({ q: 'Bar' }).loginAs(office)
    assert.deepEqual(
      (picker.body().customers as { displayName: string }[]).map((c) => c.displayName),
      ['Bar Nuovo']
    )

    await client.post(`/customers/${customer.id}/restore`).withCsrfToken().loginAs(office)
    await customer.refresh()
    assert.isNull(customer.archivedAt)
  })

  test('archiving is refused while Jobs are not cancelled', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()
    const job = await createJob(customer, { siteId: site.id })

    for (const url of [`/customers/${customer.id}/archive`, `/sites/${site.id}/archive`]) {
      const response = await client.post(url).withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.hasOpenJobs'))
    }
    await customer.refresh()
    assert.isNull(customer.archivedAt)

    job.merge({ status: 'cancelled', cancelledAt: DateTime.now() })
    await job.save()
    await client.post(`/sites/${site.id}/archive`).withCsrfToken().loginAs(office)
    await site.refresh()
    assert.isNotNull(site.archivedAt)
  })

  test('new Jobs, Invoices and links refuse archived records; existing Jobs keep theirs', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()
    const job = await createJob(customer, { siteId: site.id, status: 'cancelled' })
    await customer.merge({ archivedAt: DateTime.now() }).save()
    await site.merge({ archivedAt: DateTime.now() }).save()
    const other = await createCustomer({ name: 'Altro' })

    const newJob = await client
      .post('/jobs')
      .form({
        customerId: String(customer.id),
        siteId: String(site.id),
        kind: 'quoted',
        workCategory: 'repair',
        title: 'X',
      })
      .header('referer', '/jobs/create')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(newJob.flashMessage('inputErrorsBag'), ['customerId', 'siteId'])

    const invoice = await client
      .post('/invoices')
      .form({ customerId: String(customer.id) })
      .header('referer', '/invoices/create')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(invoice.flashMessage('inputErrorsBag'), ['customerId'])

    const link = await client
      .post(`/customers/${other.id}/sites`)
      .form({ siteId: String(site.id) })
      .header('referer', `/customers/${other.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(link.flashMessage('inputErrorsBag'), ['siteId'])

    // The cancelled Job still validates with its own (archived) Customer and Site
    const { jobValidator } = await import('#validators/job')
    const data = await jobValidator.validate(
      {
        customerId: customer.id,
        siteId: site.id,
        kind: 'quoted',
        workCategory: 'repair',
        title: 'X',
      },
      { meta: { customerId: job.customerId, siteId: job.siteId ?? undefined } }
    )
    assert.equal(data.customerId, customer.id)
  })

  test('Technicians and the Superuser can not archive', async ({ client, assert }) => {
    const customer = await createCustomer()
    const site = await createSite()
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of [
        `/customers/${customer.id}/archive`,
        `/customers/${customer.id}/restore`,
        `/sites/${site.id}/archive`,
        `/sites/${site.id}/restore`,
      ]) {
        const response = await client
          .post(url)
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    await customer.refresh()
    await site.refresh()
    assert.isNull(customer.archivedAt)
    assert.isNull(site.archivedAt)
  })
})

test.group('Removing Installed Equipment', () => {
  test('removed and replaced equipment leaves the current list', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const old = await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia vecchia',
    })
    const fresh = await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia nuova',
    })

    await client
      .post(`/equipment/${old.id}/remove`)
      .form({ removedOn: DateTime.now().toISODate()!, replacedById: String(fresh.id) })
      .withCsrfToken()
      .loginAs(office)

    await old.refresh()
    assert.equal(old.removedOn?.toISODate(), DateTime.now().toISODate())
    assert.equal(old.replacedById, fresh.id)
    const page = await client.get(`/sites/${site.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      installedEquipment: [{ id: fresh.id, removedOn: null }],
      removedEquipment: [{ id: old.id, replacedBy: 'Caldaia nuova' }],
    })

    // Already removed: a second removal is refused
    const again = await client
      .post(`/equipment/${old.id}/remove`)
      .form({ removedOn: DateTime.now().toISODate()! })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertFlashMessage('error', it('flash.invalidRemoval'))
  })

  test('the replacement must be current equipment at the same Site', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const otherSite = await createSite()
    const elsewhere = await InstalledEquipment.create({
      siteId: otherSite.id,
      equipmentType: 'Altro',
    })
    const old = await InstalledEquipment.create({ siteId: site.id, equipmentType: 'Caldaia' })

    const refused = await client
      .post(`/equipment/${old.id}/remove`)
      .form({ removedOn: DateTime.now().toISODate()!, replacedById: String(elsewhere.id) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.invalidRemoval'))
    await old.refresh()
    assert.isNull(old.removedOn)

    const future = await client
      .post(`/equipment/${old.id}/remove`)
      .form({ removedOn: DateTime.now().plus({ days: 3 }).toISODate()! })
      .header('referer', `/sites/${site.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(future.flashMessage('inputErrorsBag'), ['removedOn'])
  })

  test('removal can not predate installation', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const boiler = await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia',
      installedOn: DateTime.fromISO('2024-05-01'),
    })

    const response = await client
      .post(`/equipment/${boiler.id}/remove`)
      .form({ removedOn: '2024-04-01' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.invalidRemoval'))
    await boiler.refresh()
    assert.isNull(boiler.removedOn)
  })

  test("removed equipment leaves the Technician's Visit page", async ({ client, assert }) => {
    const anna = await createUser('technician')
    const site = await createSite()
    const job = await createJob(await createCustomer(), { siteId: site.id, status: 'in_progress' })
    const start = DateTime.now().plus({ hours: 1 })
    const visit = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 1 }),
      status: 'planned',
    })
    await visit.related('technicians').attach([anna.id])
    await InstalledEquipment.create({ siteId: site.id, equipmentType: 'Caldaia nuova' })
    await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia vecchia',
      removedOn: DateTime.now().minus({ days: 1 }),
    })

    const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)

    const equipment = (page.inertiaProps.site as { equipment: { description: string }[] }).equipment
    assert.deepEqual(
      equipment.map((e) => e.description),
      ['Caldaia nuova']
    )
  })

  test('Technicians and the Superuser can not remove equipment', async ({ client, assert }) => {
    const site = await createSite()
    const boiler = await InstalledEquipment.create({ siteId: site.id, equipmentType: 'Caldaia' })
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      const response = await client
        .post(`/equipment/${boiler.id}/remove`)
        .form({ removedOn: DateTime.now().toISODate()! })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    await boiler.refresh()
    assert.isNull(boiler.removedOn)
  })
})
