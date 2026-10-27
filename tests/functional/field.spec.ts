import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import Visit from '#models/visit'
import VisitPhoto from '#models/visit_photo'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

async function visitFor(technicianIds: number[], startsAt = DateTime.now().plus({ hours: 1 })) {
  const site = await createSite({ accessNotes: 'Chiavi dal portiere' })
  await site
    .related('installedEquipment')
    .create({ equipmentType: 'Caldaia', serialNumber: 'SN-1' })
  const customer = await createCustomer({ phone: '+39 333 1234567' })
  const job = await createJob(customer, {
    siteId: site.id,
    status: 'in_progress',
    description: 'Perdita',
  })
  const visit = await Visit.create({
    jobId: job.id,
    startsAt,
    endsAt: startsAt.plus({ hours: 2 }),
    status: 'planned',
    notes: 'Portare raccordi da 1/2',
  })
  await visit.related('technicians').attach(technicianIds)
  return visit
}

/**
 * Every key in a JSON value, at any depth.
 */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)])
  }
  return []
}

test.group('Technician screens', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Technicians land on their own Visits', async ({ client, assert }) => {
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const mine = await visitFor([anna.id])
    await visitFor([bruno.id])

    const login = await client
      .post('/login')
      .form({ email: anna.email, password: 'password' })
      .withCsrfToken()
      .redirects(0)
    login.assertHeader('location', '/my-visits')

    const response = await client.get('/my-visits').withInertia().loginAs(anna)
    const visits = response.inertiaProps.visits as { id: number }[]
    assert.deepEqual(
      visits.map((visit) => visit.id),
      [mine.id]
    )
  })

  test("a Technician can't open someone else's Visit", async ({ client }) => {
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const theirs = await visitFor([bruno.id])

    const response = await client.get(`/my-visits/${theirs.id}`).withInertia().loginAs(anna)

    response.assertStatus(403)
  })

  test('the Visit shows Customer, Site, equipment and notes, but no prices', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const visit = await visitFor([anna.id])
    const item = await createItem({ purchasePrice: '10', resalePrice: '13.5' })
    await visit.load('job')
    const site = await visit.job.related('site').query().firstOrFail()
    const equipment = await site.related('installedEquipment').query().firstOrFail()
    equipment.itemId = item.id
    await equipment.save()

    const response = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)

    response.assertInertiaPropsContains({
      customer: { phone: '+39 333 1234567' },
      site: { accessNotes: 'Chiavi dal portiere', equipment: [{ serialNumber: 'SN-1' }] },
      visit: { officeNotes: 'Portare raccordi da 1/2' },
      job: { description: 'Perdita' },
    })
    const forbidden = keysOf(response.inertiaProps).filter((key) =>
      /price|cost|total|margin|markup/i.test(key)
    )
    assert.deepEqual(forbidden, [])
    assert.notInclude(JSON.stringify(response.inertiaProps), '13.5')

    const list = await client.get('/my-visits').withInertia().loginAs(anna)
    assert.deepEqual(
      keysOf(list.inertiaProps).filter((key) => /price|cost|total|margin|markup/i.test(key)),
      []
    )
  })

  test('saves status changes and notes', async ({ client, assert }) => {
    const anna = await createUser('technician')
    const visit = await visitFor([anna.id])

    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'needs_return' })
      .withCsrfToken()
      .loginAs(anna)
    await client
      .post(`/my-visits/${visit.id}/notes`)
      .form({ body: 'Serve un pezzo di ricambio' })
      .withCsrfToken()
      .loginAs(anna)

    await visit.refresh()
    assert.equal(visit.status, 'needs_return')
    await visit.load('fieldNotes')
    assert.equal(visit.fieldNotes[0].body, 'Serve un pezzo di ricambio')
    assert.equal(visit.fieldNotes[0].userId, anna.id)
  })

  test('uploads photos that only the team and the office can open', async ({ client, assert }) => {
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const office = await createUser('office')
    const visit = await visitFor([anna.id])

    await client
      .post(`/my-visits/${visit.id}/photos`)
      .file('photo', app.makePath('tests/fixtures/logo.png'))
      .withCsrfToken()
      .loginAs(anna)

    const photo = await VisitPhoto.firstOrFail()
    assert.isTrue(existsSync(storagePath(photo.filePath)))
    for (const [user, status] of [
      [anna, 200],
      [office, 200],
      [bruno, 403],
    ] as const) {
      const response = await client.get(`/visit-photos/${photo.id}`).loginAs(user)
      response.assertStatus(status)
    }
  })

  test("Technicians can't change another team's Visit", async ({ client, assert }) => {
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const theirs = await visitFor([bruno.id])

    const response = await client
      .post(`/my-visits/${theirs.id}/status`)
      .form({ status: 'done' })
      .header('referer', '/my-visits')
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)

    response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    await theirs.refresh()
    assert.equal(theirs.status, 'planned')
  })

  test("a cancelled Job's Visits leave the Technician's list", async ({ client, assert }) => {
    const anna = await createUser('technician')
    const visit = await visitFor([anna.id])
    await visit.load('job')
    visit.job.status = 'cancelled'
    await visit.job.save()

    const response = await client.get('/my-visits').withInertia().loginAs(anna)

    assert.lengthOf(response.inertiaProps.visits as unknown[], 0)
  })
})

test.group('To schedule', () => {
  test('lists Visits needing another visit until one is planned', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const visit = await visitFor([anna.id], DateTime.now().minus({ days: 1 }))
    visit.status = 'needs_return'
    await visit.save()

    const before = await client.get('/agenda/to-schedule').withInertia().loginAs(office)
    before.assertInertiaPropsContains({ visits: [{ id: visit.id }] })

    const later = DateTime.now().plus({ days: 2 })
    await Visit.create({
      jobId: visit.jobId,
      startsAt: later,
      endsAt: later.plus({ hours: 1 }),
      status: 'planned',
    })
    const after = await client.get('/agenda/to-schedule').withInertia().loginAs(office)
    assert.lengthOf(after.inertiaProps.visits as unknown[], 0)
  })

  test('Technicians can not see the list', async ({ client }) => {
    const technician = await createUser('technician')
    const response = await client.get('/agenda/to-schedule').withInertia().loginAs(technician)
    response.assertStatus(403)
  })
})
