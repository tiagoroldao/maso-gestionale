import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Visit from '#models/visit'
import Quote from '#models/quote'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

function plan(technicianIds: number[], overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-11-03',
    startTime: '09:00',
    durationMinutes: 120,
    technicianIds,
    notes: 'Portare la chiave del locale caldaia',
    ...overrides,
  }
}

test.group('Planning Visits', () => {
  test('plans a Visit with several Technicians', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const job = await createJob(await createCustomer(), { kind: 'time_and_materials' })

    await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan([anna.id, bruno.id]))
      .withCsrfToken()
      .loginAs(office)

    const visit = await Visit.query().preload('technicians').firstOrFail()
    assert.equal(visit.startsAt.toFormat("yyyy-MM-dd'T'HH:mm"), '2026-11-03T09:00')
    assert.equal(visit.endsAt.toFormat('HH:mm'), '11:00')
    assert.equal(visit.status, 'planned')
    assert.sameMembers(
      visit.technicians.map((t) => t.id),
      [anna.id, bruno.id]
    )
  })

  test('the first Visit starts the work when the Job is ready', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const customer = await createCustomer()
    const cases = [
      { kind: 'time_and_materials' as const, status: 'open' as const, expected: 'in_progress' },
      { kind: 'quoted' as const, status: 'accepted' as const, expected: 'in_progress' },
      // A survey before the Quote is accepted leaves the Job alone
      { kind: 'quoted' as const, status: 'open' as const, expected: 'open' },
      { kind: 'quoted' as const, status: 'quoted' as const, expected: 'quoted' },
    ]

    for (const { kind, status, expected } of cases) {
      const job = await createJob(customer, { kind, status })
      await client
        .post(`/jobs/${job.id}/visits`)
        .json(plan([technician.id]))
        .withCsrfToken()
        .loginAs(office)
      await job.refresh()
      assert.equal(job.status, expected, `${kind} ${status}`)
    }
  })

  test('accepting a Quote with work already booked starts the Job', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer(), { kind: 'quoted', status: 'quoted' })
    await Quote.create({ jobId: job.id, status: 'draft' })
    await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan([technician.id]))
      .withCsrfToken()
      .loginAs(office)
    await job.refresh()
    assert.equal(job.status, 'quoted')

    await client.post(`/jobs/${job.id}/quote/accept`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'in_progress')
  })

  test('cancelled Jobs get no Visits', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer(), { status: 'cancelled' })

    const response = await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan([technician.id]))
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.jobNotSchedulable'))
    assert.lengthOf(await Visit.all(), 0)
  })

  test('only active Technicians can be assigned', async ({ client, assert }) => {
    const office = await createUser('office')
    const inactive = await createUser('technician', { isActive: false })
    const job = await createJob(await createCustomer())

    for (const ids of [[], [office.id], [inactive.id]]) {
      const response = await client
        .post(`/jobs/${job.id}/visits`)
        .json(plan(ids))
        .header('referer', `/jobs/${job.id}/visits/create`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      const errors = response.flashMessage('inputErrorsBag') ?? {}
      assert.isTrue(
        Object.keys(errors).some((key) => key.startsWith('technicianIds')),
        `refused ${JSON.stringify(ids)}`
      )
    }
    assert.lengthOf(await Visit.all(), 0)
  })
})

test.group('Agenda', () => {
  async function visitFor(technicianIds: number[], startsAt: string, minutes = 120) {
    const job = await createJob(await createCustomer())
    const start = DateTime.fromISO(startsAt)
    const visit = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ minutes }),
      status: 'planned',
    })
    await visit.related('technicians').attach(technicianIds)
    return visit
  }

  test('shows the day or the week, one lane per active Technician', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician', { fullName: 'Anna' })
    await createUser('technician', { fullName: 'Old', isActive: false })
    await visitFor([anna.id], '2026-11-03T09:00') // Tuesday
    await visitFor([anna.id], '2026-11-05T14:00') // Thursday

    const day = await client.get('/agenda').qs({ date: '2026-11-03' }).withInertia().loginAs(office)
    day.assertInertiaPropsContains({
      view: 'day',
      days: ['2026-11-03'],
      technicians: [{ id: anna.id }],
    })
    assert.lengthOf(day.inertiaProps.technicians as unknown[], 1)
    assert.lengthOf(day.inertiaProps.visits as unknown[], 1)

    const week = await client
      .get('/agenda')
      .qs({ date: '2026-11-05', view: 'week' })
      .withInertia()
      .loginAs(office)
    week.assertInertiaPropsContains({ from: '2026-11-02' })
    assert.lengthOf(week.inertiaProps.visits as unknown[], 2)
  })

  test('moving a Visit keeps its length', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const visit = await visitFor([anna.id], '2026-11-03T09:00', 90)

    await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-04T14:30', fromTechnicianId: anna.id, toTechnicianId: anna.id })
      .withCsrfToken()
      .loginAs(office)

    await visit.refresh()
    assert.equal(visit.startsAt.toFormat("yyyy-MM-dd'T'HH:mm"), '2026-11-04T14:30')
    assert.equal(visit.endsAt.toFormat('HH:mm'), '16:00')
  })

  test('dropping on another lane hands the Visit to that Technician', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const carla = await createUser('technician')
    const visit = await visitFor([anna.id, carla.id], '2026-11-03T09:00')

    await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-03T09:00', fromTechnicianId: anna.id, toTechnicianId: bruno.id })
      .withCsrfToken()
      .loginAs(office)

    await visit.load('technicians')
    assert.sameMembers(
      visit.technicians.map((t) => t.id),
      [bruno.id, carla.id]
    )
  })

  test('a stale hand-over is refused instead of adding a Technician', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const carla = await createUser('technician')
    const visit = await visitFor([bruno.id], '2026-11-03T09:00')

    // The page still showed the Visit in Anna's lane
    const response = await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-03T09:00', fromTechnicianId: anna.id, toTechnicianId: carla.id })
      .header('referer', '/agenda')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.visitNotMovable'))
    await visit.load('technicians')
    assert.deepEqual(
      visit.technicians.map((t) => t.id),
      [bruno.id]
    )
  })

  test('handing over to a Technician already on the Visit removes the original', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const visit = await visitFor([anna.id, bruno.id], '2026-11-03T09:00')

    await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-03T09:00', fromTechnicianId: anna.id, toTechnicianId: bruno.id })
      .withCsrfToken()
      .loginAs(office)

    await visit.load('technicians')
    assert.deepEqual(
      visit.technicians.map((t) => t.id),
      [bruno.id]
    )
  })

  test('done Visits and cancelled Jobs can not be moved', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const done = await visitFor([anna.id], '2026-11-03T09:00')
    done.status = 'done'
    await done.save()
    const ofCancelled = await visitFor([anna.id], '2026-11-03T14:00')
    await ofCancelled.load('job')
    ofCancelled.job.status = 'cancelled'
    await ofCancelled.job.save()

    for (const visit of [done, ofCancelled]) {
      const response = await client
        .patch(`/visits/${visit.id}/move`)
        .json({ startsAt: '2026-11-05T09:00' })
        .header('referer', '/agenda')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('error', it('flash.visitNotMovable'))
      const before = visit.startsAt.toISO()
      await visit.refresh()
      assert.equal(visit.startsAt.toISO(), before)
    }
  })

  test("a cancelled Job's Visits leave the agenda", async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const visit = await visitFor([anna.id], '2026-11-03T09:00')
    await client.post(`/jobs/${visit.jobId}/cancel`).withCsrfToken().loginAs(office)

    const day = await client.get('/agenda').qs({ date: '2026-11-03' }).withInertia().loginAs(office)

    assert.lengthOf(day.inertiaProps.visits as unknown[], 0)
    assert.isNotNull(await Visit.find(visit.id))
  })

  test('impossible dates are refused, not crashed on', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const visit = await visitFor([anna.id], '2026-11-03T09:00')

    const response = await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-02-30T10:00' })
      .header('referer', '/agenda')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['startsAt'])
  })

  test('Technicians can not use the agenda', async ({ client }) => {
    const technician = await createUser('technician')
    const visit = await visitFor([technician.id], '2026-11-03T09:00')

    const page = await client.get('/agenda').withInertia().loginAs(technician)
    page.assertStatus(403)

    const move = await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-04T09:00' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(technician)
      .redirects(0)
    move.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
  })
})
