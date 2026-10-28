import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import Visit from '#models/visit'
import Quote from '#models/quote'
import LabourRate from '#models/labour_rate'
import FieldWork from '#services/field_work'
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
    const job = await createJob(await createCustomer())

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
    // Without a Quote an open Job is ready; with one, once it is accepted
    const cases = [
      { quote: null, status: 'open' as const, expected: 'in_progress' },
      { quote: 'accepted' as const, status: 'accepted' as const, expected: 'in_progress' },
      // A survey before the Quote is accepted leaves the Job alone
      { quote: 'draft' as const, status: 'open' as const, expected: 'open' },
      { quote: 'draft' as const, status: 'quoted' as const, expected: 'quoted' },
    ]

    for (const { quote, status, expected } of cases) {
      const job = await createJob(customer, { status })
      if (quote) await Quote.create({ jobId: job.id, status: quote })
      await client
        .post(`/jobs/${job.id}/visits`)
        .json(plan([technician.id]))
        .withCsrfToken()
        .loginAs(office)
      await job.refresh()
      assert.equal(job.status, expected, `${quote ?? 'no Quote'} ${status}`)
    }
  })

  test('accepting a Quote with work already booked starts the Job', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer(), { status: 'quoted' })
    await Quote.create({ jobId: job.id, status: 'draft' })
    // Booked for next week, so it is upcoming whenever the test runs
    const nextWeek = DateTime.now().plus({ weeks: 1 }).toFormat('yyyy-MM-dd')
    await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan([technician.id], { date: nextWeek }))
      .withCsrfToken()
      .loginAs(office)
    await job.refresh()
    assert.equal(job.status, 'quoted')

    await client.post(`/jobs/${job.id}/quote/accept`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'in_progress')
  })

  test('a past survey does not start the Job on acceptance', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer(), { status: 'quoted' })
    await Quote.create({ jobId: job.id, status: 'draft' })
    const lastWeek = DateTime.now().minus({ weeks: 1 }).toFormat('yyyy-MM-dd')
    await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan([technician.id], { date: lastWeek }))
      .withCsrfToken()
      .loginAs(office)

    await client.post(`/jobs/${job.id}/quote/accept`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'accepted')
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

  test('closed Visits and cancelled Jobs can not be moved', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const done = await visitFor([anna.id], '2026-11-03T09:00')
    done.status = 'done'
    await done.save()
    const needsReturn = await visitFor([anna.id], '2026-11-03T11:00')
    needsReturn.status = 'needs_return'
    await needsReturn.save()
    const ofCancelled = await visitFor([anna.id], '2026-11-03T14:00')
    await ofCancelled.load('job')
    ofCancelled.job.status = 'cancelled'
    await ofCancelled.job.save()

    for (const visit of [done, needsReturn, ofCancelled]) {
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

test.group('Editing and deleting Visits', () => {
  /**
   * A Visit planned through the app, so the Job moves as it really would:
   * on an open Job, or on one whose Quote was accepted when `acceptedAt`.
   */
  async function planned(client: ApiClient, technicianIds: number[], acceptedAt?: DateTime) {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), {
      status: acceptedAt ? 'accepted' : 'open',
    })
    if (acceptedAt) {
      await Quote.create({ jobId: job.id, status: 'accepted', decidedAt: acceptedAt })
    }
    await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan(technicianIds))
      .withCsrfToken()
      .loginAs(office)
    const visit = await Visit.query().where('jobId', job.id).preload('technicians').firstOrFail()
    return { office, job, visit }
  }

  test('Office changes the time, length, team and notes', async ({ client, assert }) => {
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const { office, visit } = await planned(client, [anna.id])

    await client
      .put(`/visits/${visit.id}`)
      .json(
        plan([bruno.id], {
          date: '2026-11-04',
          startTime: '14:30',
          durationMinutes: 90,
          notes: 'Citofonare',
        })
      )
      .withCsrfToken()
      .loginAs(office)

    await visit.refresh()
    await visit.load('technicians')
    assert.equal(
      visit.startsAt.toISO({ includeOffset: false, suppressMilliseconds: true }),
      '2026-11-04T14:30:00'
    )
    assert.equal(visit.endsAt.diff(visit.startsAt, 'minutes').minutes, 90)
    assert.deepEqual(
      visit.technicians.map((t) => t.id),
      [bruno.id]
    )
    assert.equal(visit.notes, 'Citofonare')
  })

  test('a deactivated Technician already on the Visit may stay; a new one may not', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const gone = await createUser('technician', { isActive: false })
    const { office, visit } = await planned(client, [anna.id])
    anna.isActive = false
    await anna.save()

    const kept = await client
      .put(`/visits/${visit.id}`)
      .json(plan([anna.id]))
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    kept.assertFlashMessage('success', it('flash.visitSaved'))

    const refused = await client
      .put(`/visits/${visit.id}`)
      .json(plan([anna.id, gone.id]))
      .header('referer', `/visits/${visit.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(refused.flashMessage('inputErrorsBag'), ['technicianIds.1'])
  })

  test('closed Visits and cancelled Jobs can not be edited or deleted', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { office, visit, job } = await planned(client, [anna.id])
    visit.status = 'done'
    await visit.save()

    for (const request of [
      client.put(`/visits/${visit.id}`).json(plan([anna.id])),
      client.delete(`/visits/${visit.id}`),
    ]) {
      const response = await request.withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.visitNotEditable'))
    }

    visit.status = 'planned'
    await visit.save()
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)
    const cancelled = await client
      .delete(`/visits/${visit.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    cancelled.assertFlashMessage('error', it('flash.visitNotEditable'))
    assert.isNotNull(await Visit.find(visit.id))
  })

  test('a Visit planned by mistake is deleted; the Job goes back to ready for work', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { office, visit, job } = await planned(client, [anna.id], DateTime.fromISO('2026-01-01'))
    await job.refresh()
    assert.equal(job.status, 'in_progress')

    const response = await client
      .delete(`/visits/${visit.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('success', it('flash.visitDeleted'))
    assert.isNull(await Visit.find(visit.id))
    await job.refresh()
    assert.equal(job.status, 'accepted')
  })

  test('deleting the work Visit next to a finished survey puts the Job back', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { office, visit, job } = await planned(
      client,
      [anna.id],
      DateTime.now().minus({ days: 5 })
    )
    // A survey done before the Quote was accepted
    const past = DateTime.now().minus({ days: 10 })
    await Visit.create({
      jobId: job.id,
      startsAt: past,
      endsAt: past.plus({ hours: 1 }),
      status: 'done',
    })

    await client.delete(`/visits/${visit.id}`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'accepted')
  })

  test('deleting a follow-up keeps a Job with done work in progress', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { office, visit, job } = await planned(client, [anna.id])
    const past = DateTime.now().minus({ days: 2 })
    await Visit.create({
      jobId: job.id,
      startsAt: past,
      endsAt: past.plus({ hours: 2 }),
      status: 'done',
    })

    await client.delete(`/visits/${visit.id}`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'in_progress')
  })

  test('a Job without a Quote goes back to open', async ({ client, assert }) => {
    const anna = await createUser('technician')
    const { office, visit, job } = await planned(client, [anna.id])
    await job.refresh()
    assert.equal(job.status, 'in_progress')

    await client.delete(`/visits/${visit.id}`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'open')
  })

  test("a cancelled Job's Visit edit page is read-only, and saving changes nothing", async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { office, visit, job } = await planned(client, [anna.id])
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)

    const page = await client.get(`/visits/${visit.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ visit: { editable: false } })
    const before = visit.startsAt.toISO()
    const refused = await client
      .put(`/visits/${visit.id}`)
      .json(plan([anna.id], { date: '2026-12-01' }))
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.visitNotEditable'))
    await visit.refresh()
    assert.equal(visit.startsAt.toISO(), before)
  })

  test("a deactivated Technician's Visit can still be moved in their own lane", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const old = await createUser('technician', { isActive: false })
    const job = await createJob(await createCustomer())
    const start = DateTime.fromISO('2026-11-03T09:00')
    const visit = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })
    await visit.related('technicians').attach([old.id])

    await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-03T11:00', fromTechnicianId: old.id, toTechnicianId: old.id })
      .withCsrfToken()
      .loginAs(office)

    await visit.refresh()
    assert.equal(visit.startsAt.toFormat('HH:mm'), '11:00')
  })

  test('a Visit with recorded work is kept', async ({ client, assert }) => {
    const anna = await createUser('technician')
    const { office, visit } = await planned(client, [anna.id])
    await visit.related('fieldNotes').create({ body: 'Cliente assente', userId: anna.id })

    const response = await client
      .delete(`/visits/${visit.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.visitHasWork'))
    assert.isNotNull(await Visit.find(visit.id))
  })

  test('Visits of a deactivated Technician stay on the Agenda', async ({ client }) => {
    const office = await createUser('office')
    const old = await createUser('technician', { fullName: 'Old', isActive: false })
    const job = await createJob(await createCustomer())
    const start = DateTime.fromISO('2026-11-03T09:00')
    const visit = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })
    await visit.related('technicians').attach([old.id])

    const day = await client.get('/agenda').qs({ date: '2026-11-03' }).withInertia().loginAs(office)

    day.assertInertiaPropsContains({
      technicians: [{ id: old.id, active: false }],
      visits: [{ id: visit.id, technicianIds: [old.id] }],
    })
  })

  test('a Technician with logged hours stays on the Visit', async ({ client, assert }) => {
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const { office, visit } = await planned(client, [anna.id])
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    await FieldWork.recordHours(visit, { technicianId: anna.id, labourRateId: rate.id, hours: '1' })

    const edited = await client
      .put(`/visits/${visit.id}`)
      .json(plan([bruno.id], { startTime: '10:00', notes: 'Altro' }))
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    edited.assertFlashMessage('error', it('flash.technicianHasHours'))

    const handedOver = await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-03T09:00', fromTechnicianId: anna.id, toTechnicianId: bruno.id })
      .header('referer', '/agenda')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    handedOver.assertFlashMessage('error', it('flash.technicianHasHours'))

    // Refused whole: the time and notes didn't change either
    await visit.refresh()
    assert.equal(visit.startsAt.toFormat('HH:mm'), '09:00')
    assert.equal(visit.notes, 'Portare la chiave del locale caldaia')
    await visit.load('technicians')
    assert.deepEqual(
      visit.technicians.map((t) => t.id),
      [anna.id]
    )

    // Adding someone alongside is fine
    await client
      .put(`/visits/${visit.id}`)
      .json(plan([anna.id, bruno.id]))
      .withCsrfToken()
      .loginAs(office)
    await visit.load('technicians')
    assert.sameMembers(
      visit.technicians.map((t) => t.id),
      [anna.id, bruno.id]
    )
  })

  test('a Visit stays on the Agenda when its Technician changes role, and can be kept', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician', { fullName: 'Anna' })
    const { office, visit } = await planned(client, [anna.id])
    await anna.merge({ role: 'office' }).save()

    const day = await client.get('/agenda').qs({ date: '2026-11-03' }).withInertia().loginAs(office)
    day.assertInertiaPropsContains({
      technicians: [{ id: anna.id }],
      visits: [{ id: visit.id, technicianIds: [anna.id] }],
    })

    // Editing the Visit with them still on it is allowed
    const edited = await client
      .put(`/visits/${visit.id}`)
      .json(plan([anna.id], { notes: 'Citofonare' }))
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    edited.assertFlashMessage('success', it('flash.visitSaved'))
    await visit.refresh()
    assert.equal(visit.notes, 'Citofonare')
  })

  test('a Visit can still be moved within the lane of someone no longer a Technician', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { office, visit } = await planned(client, [anna.id])
    await anna.merge({ role: 'office' }).save()

    await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-03T11:00', fromTechnicianId: anna.id, toTechnicianId: anna.id })
      .withCsrfToken()
      .loginAs(office)

    await visit.refresh()
    assert.equal(visit.startsAt.toFormat('HH:mm'), '11:00')
  })

  test('only active Technicians can join a Visit, by edit or hand-over', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { office, visit } = await planned(client, [anna.id])
    const clerk = await createUser('office')

    const edited = await client
      .put(`/visits/${visit.id}`)
      .json(plan([anna.id, clerk.id]))
      .header('referer', `/visits/${visit.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(edited.flashMessage('inputErrorsBag'), ['technicianIds.1'])

    const handedOver = await client
      .patch(`/visits/${visit.id}/move`)
      .json({ startsAt: '2026-11-03T09:00', fromTechnicianId: anna.id, toTechnicianId: clerk.id })
      .header('referer', '/agenda')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(handedOver.flashMessage('inputErrorsBag'), ['toTechnicianId'])

    await visit.load('technicians')
    assert.deepEqual(
      visit.technicians.map((t) => t.id),
      [anna.id]
    )
  })

  test('Visits with no Technician are listed apart on the Agenda', async ({ client }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer())
    const start = DateTime.fromISO('2026-11-03T09:00')
    const visit = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })

    const day = await client.get('/agenda').qs({ date: '2026-11-03' }).withInertia().loginAs(office)
    day.assertInertiaPropsContains({
      unassigned: [{ id: visit.id, job: { number: job.number } }],
    })
  })

  test('Technicians and the Superuser can not edit or delete Visits', async ({
    client,
    assert,
  }) => {
    const job = await createJob(await createCustomer())
    const start = DateTime.fromISO('2026-11-03T09:00')
    const visit = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const request of [
        client.put(`/visits/${visit.id}`).json(plan([user.id])),
        client.delete(`/visits/${visit.id}`),
      ]) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
      const page = await client.get(`/visits/${visit.id}/edit`).withInertia().loginAs(user)
      page.assertStatus(403)
    }
    assert.isNotNull(await Visit.find(visit.id))
  })
})
