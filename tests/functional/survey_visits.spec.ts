import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import Visit from '#models/visit'
import type Job from '#models/job'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { createQuote } from '#tests/helpers/quotes'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * Tomorrow, so the Visit is upcoming and on the Technician's list whenever
 * the test runs.
 */
const tomorrow = () => DateTime.now().plus({ days: 1 }).toFormat('yyyy-MM-dd')

function plan(technicianIds: number[], overrides: Record<string, unknown> = {}) {
  return {
    date: tomorrow(),
    startTime: '09:00',
    durationMinutes: 60,
    technicianIds,
    ...overrides,
  }
}

/**
 * A one-hour Visit `days` from today (tomorrow by default).
 */
async function visitOf(job: Job, attributes: Partial<Visit> = {}, days = 1) {
  const start = DateTime.now().plus({ days }).set({ hour: 9, minute: 0 })
  return Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 1 }),
    status: 'planned',
    ...attributes,
  })
}

test.group('Survey Visits: planning', () => {
  test('Office and the Admin plan a Survey; the Job stays open, Quote or not', async ({
    client,
    assert,
  }) => {
    const technician = await createUser('technician')
    const customer = await createCustomer()
    for (const role of ['office', 'admin'] as const) {
      const user = await createUser(role)
      const open = await createJob(customer)
      const accepted = await createJob(customer)
      await createQuote(accepted, { status: 'accepted', decidedAt: DateTime.now() })

      for (const job of [open, accepted]) {
        const response = await client
          .post(`/jobs/${job.id}/visits`)
          .json(plan([technician.id], { survey: true }))
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('success', it('flash.visitPlanned'))
        const visit = await Visit.findByOrFail('jobId', job.id)
        assert.isTrue(visit.survey, role)
      }
      await open.refresh()
      await accepted.refresh()
      assert.equal(open.status, 'open', role)
      assert.equal(accepted.status, 'open', role)
    }
  })

  test('a Visit is work unless marked', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer())

    await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan([technician.id]))
      .withCsrfToken()
      .loginAs(office)

    const visit = await Visit.findByOrFail('jobId', job.id)
    assert.isFalse(visit.survey)
    await job.refresh()
    assert.equal(job.status, 'in_progress')
  })

  test('Technicians and the Superuser can not plan or mark Surveys', async ({ client, assert }) => {
    const job = await createJob(await createCustomer())
    const visit = await visitOf(job)

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const request of [
        client.post(`/jobs/${job.id}/visits`).json(plan([user.id], { survey: true })),
        client.put(`/visits/${visit.id}`).json(plan([user.id], { survey: true })),
      ]) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.lengthOf(await Visit.all(), 1)
    await visit.refresh()
    assert.isFalse(visit.survey)
  })

  test('accepting a Quote with only a Survey booked leaves the Job open', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer())
    const quote = await createQuote(job, { status: 'sent' })
    await client
      .post(`/jobs/${job.id}/visits`)
      .json(plan([technician.id], { survey: true }))
      .withCsrfToken()
      .loginAs(office)

    await client.post(`/quotes/${quote.id}/accept`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'open')
  })
})

test.group('Survey Visits: editing', () => {
  test('marking the only work Visit as a Survey reopens the Job; unmarking starts it', async ({
    client,
    assert,
  }) => {
    const technician = await createUser('technician')
    const customer = await createCustomer()
    const withQuote = await createJob(customer, { status: 'in_progress' })
    await createQuote(withQuote, { status: 'accepted', decidedAt: DateTime.now() })
    const jobs = [withQuote, await createJob(customer, { status: 'in_progress' })]

    for (const role of ['office', 'admin'] as const) {
      const user = await createUser(role)
      for (const job of jobs) {
        const visit = await visitOf(job)
        await visit.related('technicians').attach([technician.id])

        const marked = await client
          .put(`/visits/${visit.id}`)
          .json(plan([technician.id], { survey: true }))
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        marked.assertFlashMessage('success', it('flash.visitSaved'))
        await visit.refresh()
        assert.isTrue(visit.survey)
        await job.refresh()
        assert.equal(job.status, 'open', `${role} marked`)

        // The checkbox left unticked: work again
        await client
          .put(`/visits/${visit.id}`)
          .json(plan([technician.id]))
          .withCsrfToken()
          .loginAs(user)
        await visit.refresh()
        assert.isFalse(visit.survey)
        await job.refresh()
        assert.equal(job.status, 'in_progress', `${role} unmarked`)

        await visit.delete()
      }
    }
  })

  test('marking a Survey keeps the Job in progress while other work remains', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(job, { status: 'done' }, -2)
    const visit = await visitOf(job)

    await client
      .put(`/visits/${visit.id}`)
      .json(plan([technician.id], { survey: true }))
      .withCsrfToken()
      .loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'in_progress')
  })

  test('a closed Visit, or one of a cancelled Job, keeps its mark', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const customer = await createCustomer()
    const done = await visitOf(await createJob(customer, { status: 'in_progress' }), {
      status: 'done',
    })
    const needsReturn = await visitOf(await createJob(customer, { status: 'in_progress' }), {
      status: 'needs_return',
    })
    const ofCancelled = await visitOf(await createJob(customer, { status: 'cancelled' }))

    for (const visit of [done, needsReturn, ofCancelled]) {
      const response = await client
        .put(`/visits/${visit.id}`)
        .json(plan([technician.id], { survey: true }))
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('error', it('flash.visitNotEditable'))
      await visit.refresh()
      assert.isFalse(visit.survey)
    }

    const page = await client.get(`/visits/${done.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ visit: { survey: false, editable: false } })
  })

  test('any change to a Visit brings the Job in line with its work', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    // Out of step with its work, as Jobs migrated from quoted or accepted
    // could have been: a past work Visit moved into the future
    const job = await createJob(await createCustomer())
    const visit = await visitOf(job, {}, -2)
    await visit.related('technicians').attach([technician.id])

    await client
      .put(`/visits/${visit.id}`)
      .json(plan([technician.id], { notes: 'Spostato' }))
      .withCsrfToken()
      .loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'in_progress')

    // Likewise a Job left in progress with only a Survey
    const surveyed = await createJob(await createCustomer(), { status: 'in_progress' })
    const survey = await visitOf(surveyed, { survey: true })
    await survey.related('technicians').attach([technician.id])
    await client
      .put(`/visits/${survey.id}`)
      .json(plan([technician.id], { survey: true, notes: 'Citofonare' }))
      .withCsrfToken()
      .loginAs(office)
    await surveyed.refresh()
    assert.equal(surveyed.status, 'open')
  })

  test('deleting the last work Visit ignores Surveys', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(job, { survey: true, status: 'done' }, -3)
    await visitOf(job, { survey: true })
    const work = await visitOf(job)

    await client.delete(`/visits/${work.id}`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'open')
  })
})

test.group('Survey Visits: shown as such', () => {
  test('on the Agenda, the Job page and the edit page, for Office and the Admin', async ({
    client,
  }) => {
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer())
    const survey = await visitOf(job, { survey: true })
    await survey.related('technicians').attach([technician.id])
    const unassigned = await visitOf(job, { survey: true })
    const date = survey.startsAt.toFormat('yyyy-MM-dd')

    for (const role of ['office', 'admin'] as const) {
      const user = await createUser(role)
      const agenda = await client.get('/agenda').qs({ date }).withInertia().loginAs(user)
      agenda.assertInertiaPropsContains({
        visits: [{ id: survey.id, survey: true }],
        unassigned: [{ id: unassigned.id, survey: true }],
      })

      const jobPage = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
      jobPage.assertInertiaPropsContains({ visits: [{ id: survey.id, survey: true }] })

      const edit = await client.get(`/visits/${survey.id}/edit`).withInertia().loginAs(user)
      edit.assertInertiaPropsContains({ visit: { survey: true, editable: true } })
    }
  })

  test("on the Technician's Visit list and Visit page", async ({ client }) => {
    const technician = await createUser('technician')
    const job = await createJob(await createCustomer())
    const survey = await visitOf(job, { survey: true })
    await survey.related('technicians').attach([technician.id])

    const list = await client.get('/my-visits').withInertia().loginAs(technician)
    list.assertInertiaPropsContains({ visits: [{ id: survey.id, survey: true }] })

    const page = await client.get(`/my-visits/${survey.id}`).withInertia().loginAs(technician)
    page.assertInertiaPropsContains({ visit: { id: survey.id, survey: true } })
  })
})

test.group('Survey Visits: Work Complete', () => {
  /**
   * The Job's status as its page shows it (TypeScript) and the list
   * filters it falls under (SQL).
   */
  async function statuses(client: ApiClient, job: Job) {
    const office = await createUser('office')
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    const shown = (page.inertiaProps.job as { status: string }).status
    const listed: string[] = []
    for (const status of ['in_progress', 'work_complete']) {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      const ids = (list.inertiaProps.jobs as { id: number }[]).map((row) => row.id)
      if (ids.includes(job.id)) listed.push(status)
    }
    return { shown, listed }
  }

  test('a Job whose only Visits are Surveys is never Work Complete', async ({ client, assert }) => {
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(job, { survey: true, status: 'done' })

    assert.deepEqual(await statuses(client, job), { shown: 'in_progress', listed: ['in_progress'] })
  })

  test('done work and done Surveys make the Job Work Complete; a Survey to do does not', async ({
    client,
    assert,
  }) => {
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(job, { survey: true, status: 'done' }, -3)
    await visitOf(job, { status: 'done' })

    assert.deepEqual(await statuses(client, job), {
      shown: 'work_complete',
      listed: ['work_complete'],
    })

    await visitOf(job, { survey: true }, 5)
    assert.deepEqual(await statuses(client, job), { shown: 'in_progress', listed: ['in_progress'] })
  })
})
