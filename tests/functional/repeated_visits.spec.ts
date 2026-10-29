import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import type Job from '#models/job'
import LabourRate from '#models/labour_rate'
import Visit, { type VisitStatus } from '#models/visit'
import FieldWork from '#services/field_work'
import { addDays, todayIso } from '#shared/dates'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * A query string as the page's form sends it, arrays with brackets.
 */
function query(fields: Record<string, string | number | (string | number)[]>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(`${key}[]`, String(item)))
    else params.append(key, String(value))
  }
  return params.toString()
}

function repeat(technicianIds: number[], overrides: Record<string, string | number | number[]>) {
  return query({
    date: '2026-12-07',
    startTime: '09:00',
    durationMinutes: 120,
    technicianIds,
    notes: 'Cantiere bagno',
    ...overrides,
  })
}

function confirmed(technicianIds: number[], dates: string[]) {
  return { dates, startTime: '09:00', durationMinutes: 120, technicianIds, notes: 'Cantiere bagno' }
}

async function visitOf(
  job: Job,
  technicianIds: number[],
  startsAt: string,
  status: VisitStatus = 'planned'
) {
  const start = DateTime.fromISO(startsAt)
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 2 }),
    status,
    notes: 'Portare il flessibile',
  })
  await visit.related('technicians').attach(technicianIds)
  return visit
}

type PreviewDate = { date: string; weekday: number; holiday: string | null; clashes: string[] }

test.group('Repeated Visits', () => {
  test('lists the dates, flagging public holidays and booked Technicians', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const anna = await createUser('technician', { fullName: 'Anna' })
    const bruno = await createUser('technician', { fullName: 'Bruno' })
    const other = await createJob(await createCustomer())
    // Anna is booked on Wednesday 9 at 10:00, overlapping 09:00–11:00
    await visitOf(other, [anna.id], '2026-12-09T10:00')
    // A cancelled Visit takes no one's time
    await visitOf(other, [anna.id], '2026-12-10T09:00', 'cancelled')
    // Bruno isn't going, so his Visit doesn't clash
    await visitOf(other, [bruno.id], '2026-12-11T09:00')
    // Back to back with 09:00–11:00 isn't a clash
    await visitOf(other, [anna.id], '2026-12-07T11:00')
    const job = await createJob(await createCustomer())

    const response = await client
      .get(
        `/jobs/${job.id}/visits/create?${repeat([anna.id], { repeat: 'weekdays', count: 5, until: '' })}`
      )
      .withInertia()
      .loginAs(office)

    response.assertStatus(200)
    const preview = response.inertiaProps.preview as { dates: PreviewDate[]; truncated: boolean }
    assert.deepEqual(preview.dates, [
      { date: '2026-12-07', weekday: 1, holiday: null, clashes: [] },
      { date: '2026-12-08', weekday: 2, holiday: 'immaculate', clashes: [] },
      { date: '2026-12-09', weekday: 3, holiday: null, clashes: ['Anna'] },
      { date: '2026-12-10', weekday: 4, holiday: null, clashes: [] },
      { date: '2026-12-11', weekday: 5, holiday: null, clashes: [] },
    ])
    assert.isFalse(preview.truncated)
    response.assertInertiaPropsContains({
      preview: { startTime: '09:00', durationMinutes: 120, technicianIds: [anna.id] },
      draft: { repeat: 'weekdays', count: 5, until: null },
    })
    assert.lengthOf(await Visit.query().where('jobId', job.id), 0)
  })

  test('on chosen days until a date', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer())

    const response = await client
      .get(
        `/jobs/${job.id}/visits/create?${repeat([anna.id], {
          repeat: 'days',
          weekdays: [1, 3],
          until: '2026-12-21',
        })}`
      )
      .withInertia()
      .loginAs(office)

    const preview = response.inertiaProps.preview as { dates: PreviewDate[] }
    assert.deepEqual(
      preview.dates.map((day) => day.date),
      ['2026-12-07', '2026-12-09', '2026-12-14', '2026-12-16', '2026-12-21']
    )
  })

  test('a repeat needs its days and an end', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer())
    const page = `/jobs/${job.id}/visits/create`

    for (const [fields, field] of [
      [{ repeat: 'days', count: 3 }, 'weekdays'],
      [{ repeat: 'daily' }, 'until'],
      [{ repeat: 'daily', until: '2026-12-01' }, 'until'],
      [{ repeat: 'daily', count: 61 }, 'count'],
      [{ repeat: 'monthly', count: 3 }, 'repeat'],
    ] as const) {
      const response = await client
        .get(`${page}?${repeat([anna.id], fields)}`)
        .header('referer', page)
        .loginAs(office)
        .redirects(0)
      assert.properties(response.flashMessage('inputErrorsBag'), [field], JSON.stringify(fields))
    }
  })

  test('plans each confirmed date as its own Visit', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const job = await createJob(await createCustomer())

    const response = await client
      .post(`/jobs/${job.id}/visits/repeated`)
      // Office dropped the 8th, a holiday
      .json(confirmed([anna.id, bruno.id], ['2026-12-09', '2026-12-07', '2026-12-10']))
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('success', it('flash.visitsPlanned', { count: 3 }))
    response.assertHeader('location', '/agenda?date=2026-12-07&view=week')
    const visits = await Visit.query()
      .where('jobId', job.id)
      .preload('technicians')
      .orderBy('startsAt')
    assert.deepEqual(
      visits.map((visit) => visit.startsAt.toFormat("yyyy-MM-dd'T'HH:mm")),
      ['2026-12-07T09:00', '2026-12-09T09:00', '2026-12-10T09:00']
    )
    for (const visit of visits) {
      assert.equal(visit.endsAt.toFormat('HH:mm'), '11:00')
      assert.equal(visit.status, 'planned')
      assert.equal(visit.notes, 'Cantiere bagno')
      assert.isFalse(visit.survey)
      assert.sameMembers(
        visit.technicians.map((technician) => technician.id),
        [anna.id, bruno.id]
      )
    }
    await job.refresh()
    assert.equal(job.status, 'in_progress')

    // Each is independent: changing or cancelling one leaves the others
    const [first, second, third] = visits
    await client
      .put(`/visits/${first.id}`)
      .json({
        date: '2026-12-08',
        startTime: '14:00',
        durationMinutes: 60,
        technicianIds: [anna.id],
        notes: 'Spostato',
      })
      .withCsrfToken()
      .loginAs(office)
    await client.post(`/visits/${second.id}/cancel`).withCsrfToken().loginAs(office)

    await first.refresh()
    await second.refresh()
    await third.refresh()
    await third.load('technicians')
    assert.equal(first.startsAt.toFormat("yyyy-MM-dd'T'HH:mm"), '2026-12-08T14:00')
    assert.equal(second.status, 'cancelled')
    assert.equal(third.startsAt.toFormat("yyyy-MM-dd'T'HH:mm"), '2026-12-10T09:00')
    assert.equal(third.status, 'planned')
    assert.equal(third.notes, 'Cantiere bagno')
    assert.lengthOf(third.technicians, 2)
  })

  test('confirming needs at least one date, and plans none on a refusal', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer())

    for (const dates of [[], ['2026-12-07', '2026-12-07'], ['2026-12-32']]) {
      const response = await client
        .post(`/jobs/${job.id}/visits/repeated`)
        .json(confirmed([anna.id], dates))
        .header('referer', `/jobs/${job.id}/visits/create`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      const errors = response.flashMessage('inputErrorsBag') ?? {}
      assert.isTrue(
        Object.keys(errors).some((key) => key.startsWith('dates')),
        JSON.stringify(dates)
      )
    }
    assert.lengthOf(await Visit.all(), 0)
  })

  test('a closed or cancelled Job takes no repeated Visits', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')

    for (const status of ['closed', 'cancelled'] as const) {
      const job = await createJob(await createCustomer(), { status })

      const preview = await client
        .get(`/jobs/${job.id}/visits/create?${repeat([anna.id], { repeat: 'daily', count: 3 })}`)
        .loginAs(office)
        .redirects(0)
      preview.assertFlashMessage('error', it('flash.jobNotSchedulable'))
      preview.assertHeader('location', `/jobs/${job.id}`)

      const store = await client
        .post(`/jobs/${job.id}/visits/repeated`)
        .json(confirmed([anna.id], ['2026-12-07', '2026-12-09']))
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      store.assertFlashMessage('error', it('flash.jobNotSchedulable'))
      await job.refresh()
      assert.equal(job.status, status)
    }
    assert.lengthOf(await Visit.all(), 0)
  })

  test('the Admin plans repeated Visits too', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer())

    const preview = await client
      .get(`/jobs/${job.id}/visits/create?${repeat([anna.id], { repeat: 'daily', count: 2 })}`)
      .withInertia()
      .loginAs(admin)
    assert.lengthOf((preview.inertiaProps.preview as { dates: unknown[] }).dates, 2)

    await client
      .post(`/jobs/${job.id}/visits/repeated`)
      .json(confirmed([anna.id], ['2026-12-07', '2026-12-08']))
      .withCsrfToken()
      .loginAs(admin)
    assert.lengthOf(await Visit.query().where('jobId', job.id), 2)
  })

  test('Technicians and the Superuser can not plan repeated Visits', async ({ client, assert }) => {
    const job = await createJob(await createCustomer())
    const visit = await visitOf(job, [], '2026-12-07T09:00')

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of [
        `/jobs/${job.id}/visits/create?${repeat([user.id], { repeat: 'daily', count: 2 })}`,
        `/jobs/${job.id}/visits/create?from=${visit.id}`,
      ]) {
        const page = await client.get(url).withInertia().loginAs(user)
        page.assertStatus(403)
      }
      const store = await client
        .post(`/jobs/${job.id}/visits/repeated`)
        .json(confirmed([user.id], ['2026-12-08', '2026-12-09']))
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      store.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await Visit.all(), 1)
  })
})

test.group('Plan the next Visit', () => {
  test('starts from a copy of the Visit, without its Charges', async ({ client, assert }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const source = await visitOf(job, [anna.id], '2026-12-09T08:30')
    source.merge({ endsAt: source.startsAt.plus({ minutes: 90 }), survey: true })
    await source.save()
    const rate = await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
    await FieldWork.recordHours(
      source,
      { technicianId: anna.id, labourRateId: rate.id, hours: '1' },
      anna
    )

    const page = await client
      .get(`/jobs/${job.id}/visits/create?from=${source.id}`)
      .withInertia()
      .loginAs(office)

    page.assertStatus(200)
    assert.deepEqual(page.inertiaProps.draft, {
      date: '2026-12-10',
      startTime: '08:30',
      durationMinutes: 90,
      technicianIds: [anna.id],
      notes: 'Portare il flessibile',
      survey: false,
      repeat: null,
      weekdays: [],
      until: null,
      count: null,
    })
    assert.isNull(page.inertiaProps.preview)

    // Planned from the copy, the new Visit has no Charges of its own
    await client
      .post(`/jobs/${job.id}/visits`)
      .json({
        date: '2026-12-10',
        startTime: '08:30',
        durationMinutes: 90,
        technicianIds: [anna.id],
      })
      .withCsrfToken()
      .loginAs(office)
    const next = await Visit.query().where('jobId', job.id).whereNot('id', source.id).firstOrFail()
    assert.lengthOf(await Charge.query().where('visitId', next.id), 0)
    assert.lengthOf(await Charge.query().where('visitId', source.id), 1)
  })

  test('a past Visit is copied to today at the earliest', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer())
    const source = await visitOf(job, [], `${addDays(todayIso(), -10)}T09:00`, 'needs_return')

    const page = await client
      .get(`/jobs/${job.id}/visits/create?from=${source.id}`)
      .withInertia()
      .loginAs(office)

    assert.equal((page.inertiaProps.draft as { date: string }).date, todayIso())
  })

  test("only the Job's own Visits are copied", async ({ client }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer())
    const other = await visitOf(await createJob(await createCustomer()), [], '2026-12-09T09:00')

    const page = await client
      .get(`/jobs/${job.id}/visits/create?from=${other.id}`)
      .withInertia()
      .loginAs(office)

    page.assertStatus(404)
  })

  test('offered on a Visit whose Job takes new work', async ({ client, assert }) => {
    const office = await createUser('office')
    for (const [status, plannable] of [
      ['in_progress', true],
      ['closed', false],
      ['cancelled', false],
    ] as const) {
      const job = await createJob(await createCustomer(), { status })
      const visit = await visitOf(job, [], '2026-12-09T09:00', 'done')

      const page = await client.get(`/visits/${visit.id}/edit`).withInertia().loginAs(office)

      assert.equal((page.inertiaProps.visit as { plannable: boolean }).plannable, plannable, status)
    }
  })
})
