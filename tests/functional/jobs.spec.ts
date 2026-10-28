import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Job from '#models/job'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

test.group('Jobs', () => {
  test('Office opens a Job with a yearly number', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()

    for (const title of ['Sostituzione caldaia', 'Perdita bagno']) {
      await client
        .post('/jobs')
        .form({
          customerId: String(customer.id),
          siteId: String(site.id),
          workCategory: 'renovation',
          title,
        })
        .withCsrfToken()
        .loginAs(office)
    }

    const jobs = await Job.query().orderBy('sequence')
    const year = DateTime.now().year
    assert.deepEqual(
      jobs.map((job) => [job.number, job.title, job.status, job.siteId]),
      [
        [`${year}/0001`, 'Sostituzione caldaia', 'open', site.id],
        [`${year}/0002`, 'Perdita bagno', 'open', site.id],
      ]
    )
    assert.deepEqual(
      jobs.map((job) => job.workCategory),
      ['renovation', 'renovation']
    )
  })

  test('numbers stay unique when Jobs are opened at the same time', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        client
          .post('/jobs')
          .form({
            customerId: String(customer.id),
            workCategory: 'repair',
            title: `Job ${i}`,
          })
          .withCsrfToken()
          .loginAs(office)
      )
    )

    const jobs = await Job.all()
    const sequences = jobs.map((job) => job.sequence).sort((a, b) => a - b)
    assert.deepEqual(sequences, [1, 2, 3, 4, 5])
  })

  test('requires a Customer, a work category and a title', async ({ client, assert }) => {
    const office = await createUser('office')

    const response = await client
      .post('/jobs')
      .form({ title: '' })
      .header('referer', '/jobs/create')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.deepEqual(Object.keys(response.flashMessage('inputErrorsBag')).sort(), [
      'customerId',
      'title',
      'workCategory',
    ])
  })

  test('Office edits an open or in progress Job', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const open = await createJob(customer)
    const started = await createJob(customer, { status: 'in_progress' })

    for (const job of [open, started]) {
      await client
        .put(`/jobs/${job.id}`)
        .form({
          customerId: String(customer.id),
          workCategory: 'sale',
          title: 'Changed',
        })
        .withCsrfToken()
        .loginAs(office)
      await job.refresh()
      assert.equal(job.title, 'Changed')
      assert.equal(job.workCategory, 'sale')
    }
  })

  test('a cancelled Job can not be edited', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const job = await createJob(customer, { status: 'cancelled', title: 'Original' })

    const response = await client
      .put(`/jobs/${job.id}`)
      .form({ customerId: String(customer.id), title: 'Changed' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.jobNotEditable'))
    await job.refresh()
    assert.equal(job.title, 'Original')
  })

  test('cancelling removes a Job from the active list', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const kept = await createJob(customer, { title: 'Kept' })
    const cancelled = await createJob(customer, { title: 'Dropped' })

    await client.post(`/jobs/${cancelled.id}/cancel`).withCsrfToken().loginAs(office)
    await cancelled.refresh()
    assert.equal(cancelled.status, 'cancelled')
    assert.isNotNull(cancelled.cancelledAt)

    const titles = async (qs: Record<string, string>) => {
      const response = await client.get('/jobs').qs(qs).withInertia().loginAs(office)
      return (response.inertiaProps.jobs as { title: string }[]).map((job) => job.title)
    }
    assert.deepEqual(await titles({}), [kept.title])
    assert.deepEqual(await titles({ status: 'cancelled' }), ['Dropped'])
    assert.sameMembers(await titles({ status: 'all' }), ['Kept', 'Dropped'])
    assert.deepEqual(await titles({ status: 'quote_sent' }), [])
  })

  test('searches by number, title and Customer name', async ({ client, assert }) => {
    const office = await createUser('office')
    const rossi = await createCustomer({
      type: 'private',
      name: null,
      vatNumber: null,
      firstName: 'Mario',
      lastName: 'Rossi',
      taxCode: 'RSSMRA85T10A562S',
    })
    const bianchi = await createCustomer({ name: 'Edilizia Bianchi' })
    const job = await createJob(rossi, { title: 'Caldaia nuova' })
    await createJob(bianchi, { title: 'Scarico' })

    const search = async (q: string) => {
      const response = await client.get('/jobs').qs({ q }).withInertia().loginAs(office)
      return (response.inertiaProps.jobs as { title: string }[]).map((row) => row.title)
    }
    assert.deepEqual(await search(job.number), ['Caldaia nuova'])
    assert.deepEqual(await search('caldaia'), ['Caldaia nuova'])
    assert.deepEqual(await search('rossi mario'), ['Caldaia nuova'])
    assert.deepEqual(await search('mario rossi'), ['Caldaia nuova'])
    assert.deepEqual(await search('bianchi'), ['Scarico'])
  })

  test('Jobs appear on the Customer and Site pages', async ({ client }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()
    const job = await createJob(customer, { siteId: site.id, title: 'Caldaia' })

    const customerPage = await client.get(`/customers/${customer.id}`).withInertia().loginAs(office)
    customerPage.assertInertiaPropsContains({ jobs: [{ id: job.id, number: job.number }] })

    const sitePage = await client.get(`/sites/${site.id}`).withInertia().loginAs(office)
    sitePage.assertInertiaPropsContains({
      jobs: [{ id: job.id, customer: { id: customer.id } }],
    })
  })

  test('the Customer picker finds Customers by name', async ({ client }) => {
    const office = await createUser('office')
    const customer = await createCustomer({ name: 'Edilizia Bianchi' })

    const response = await client.get('/customers/search').qs({ q: 'bianc' }).loginAs(office)

    response.assertBodyContains({
      customers: [{ id: customer.id, displayName: 'Edilizia Bianchi' }],
    })
  })

  test('Technicians can not manage Jobs', async ({ client, assert }) => {
    const technician = await createUser('technician')
    const customer = await createCustomer()
    const job = await createJob(customer)

    for (const url of ['/jobs', '/jobs/create', `/jobs/${job.id}`]) {
      const response = await client.get(url).withInertia().loginAs(technician)
      response.assertStatus(403)
    }
    const response = await client
      .post(`/jobs/${job.id}/cancel`)
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(technician)
      .redirects(0)
    response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    await job.refresh()
    assert.equal(job.status, 'open')
  })
})
