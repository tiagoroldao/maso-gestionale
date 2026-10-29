import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import Customer from '#models/customer'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
import Payment from '#models/payment'
import Quote from '#models/quote'
import Site from '#models/site'
import Visit from '#models/visit'
import type User from '#models/user'
import Archiving, { ArchivedRecordError, HasOpenJobsError } from '#services/archiving'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Jobs from '#services/jobs'
import Payments from '#services/payments'
import Quotes from '#services/quotes'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { JOB_PAID_SQL } from '#services/job_status'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

function post(client: ApiClient, user: User, url: string) {
  return client.post(url).header('referer', '/').withCsrfToken().loginAs(user).redirects(0)
}

function visitOf(job: Job, attributes: Partial<Visit> = {}, days = 0) {
  const startsAt = DateTime.fromISO('2026-10-03T09:00').plus({ days })
  return Visit.create({
    jobId: job.id,
    startsAt,
    endsAt: startsAt.plus({ hours: 2 }),
    status: 'planned',
    ...attributes,
  })
}

/**
 * An issued Invoice of 122.00 (100 + 22% VAT) for the Job.
 */
async function issued(job: Job) {
  await completeCompany()
  const invoice = await Invoices.create(await Customer.findOrFail(job.customerId))
  await invoice.merge({ jobId: job.id }).save()
  const standard = await vatCode()
  await Invoices.save(invoice, {
    lines: [{ description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id }],
  })
  await Invoices.finalise(invoice)
  await invoice.refresh()
  return invoice
}

/**
 * A Job whose work is done, billed from its Charges and, if `paid`, paid.
 */
async function finishedJob(paid = true) {
  await completeCompany()
  const anna = await createUser('technician')
  const job = await createJob(await createCustomer(), { status: 'in_progress' })
  const visit = await visitOf(job)
  await visit.related('technicians').attach([anna.id])
  const rate = await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
  await FieldWork.recordHours(visit, { technicianId: anna.id, labourRateId: rate.id, hours: '2' })
  await FieldWork.setStatus(visit, 'done', anna)
  const invoice = await Invoices.fromJob(job)
  await Invoices.finalise(invoice)
  await invoice.refresh()
  if (paid) await Payments.record(invoice, { amount: invoice.total!, paidOn: DateTime.now() })
  return { job, visit, invoice, anna }
}

test.group('Closing and reopening Jobs', () => {
  test('Office closes a Job and reopens it, back to open or in progress by its Visits', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const admin = await createUser('admin')
    const open = await createJob(await createCustomer())
    const surveyed = await createJob(await createCustomer())
    await visitOf(surveyed, { survey: true, status: 'done' })
    const working = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(working, { status: 'done' })

    for (const [job, user, reopened] of [
      [open, office, 'open'],
      [surveyed, admin, 'open'],
      [working, office, 'in_progress'],
    ] as const) {
      const closed = await post(client, user, `/jobs/${job.id}/close`)
      closed.assertFlashMessage('success', it('flash.jobClosedNow', { number: job.number }))
      await job.refresh()
      assert.equal(job.status, 'closed')
      assert.isNotNull(job.closedAt)

      // Closing again changes nothing
      const closedAt = job.closedAt!.toISO()
      await post(client, user, `/jobs/${job.id}/close`)
      await job.refresh()
      assert.equal(job.closedAt!.toISO(), closedAt)

      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
      page.assertInertiaPropsContains({ job: { status: 'closed' }, leftToClose: null })

      const response = await post(client, user, `/jobs/${job.id}/reopen`)
      response.assertFlashMessage('success', it('flash.jobReopened', { number: job.number }))
      await job.refresh()
      assert.equal(job.status, reopened)
      assert.isNull(job.closedAt)

      // Reopening an active Job changes nothing
      await post(client, user, `/jobs/${job.id}/reopen`)
      await job.refresh()
      assert.equal(job.status, reopened)
    }
  })

  test('closing shows what is left as a warning, and never refuses', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    await visitOf(job)
    await visitOf(job, { status: 'needs_return' }, -1)
    await Charges.add(
      job,
      { description: 'Uscita', quantity: '1', unit: null, unitPrice: '35', vatKind: 'labour' },
      office
    )
    // One unpaid, one overpaid
    await issued(job)
    const overpaid = await issued(job)
    await Payments.record(overpaid, { amount: '130', paidOn: DateTime.now() })
    // An advance nobody took back, and another still a draft
    const pricedAdvance = async () => {
      const advance = await Invoices.createAdvance(job)
      await advance.load('lines')
      await Invoices.save(advance, {
        lines: [
          {
            description: advance.lines[0].description,
            quantity: '1',
            unitPrice: '50',
            vatCodeId: advance.lines[0].vatCodeId,
          },
        ],
      })
      return advance
    }
    await Invoices.finalise(await pricedAdvance())
    const draftAdvance = await pricedAdvance()

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    // The needs-return Visit has the planned one after it: one Visit to do
    page.assertInertiaPropsContains({
      leftToClose: { visits: 1, charges: 1, unpaid: 2, overpaid: 1, advances: 1, drafts: 1 },
    })

    const response = await post(client, office, `/jobs/${job.id}/close`)
    response.assertFlashMessage(
      'warning',
      it('flash.jobClosedWithLeft', {
        number: job.number,
        left: [
          it('ui.jobs.leftToClose.visits', { count: 1 }),
          it('ui.jobs.leftToClose.charges', { count: 1 }),
          it('ui.jobs.leftToClose.unpaid', { count: 2 }),
          it('ui.jobs.leftToClose.overpaid', { count: 1 }),
          it('ui.jobs.leftToClose.advances', { count: 1 }),
          it('ui.jobs.leftToClose.drafts', { count: 1 }),
        ].join(', '),
      })
    )
    await job.refresh()
    assert.equal(job.status, 'closed')

    // The draft advance is no longer issued: an advance is for work to come
    const finalised = await post(client, office, `/invoices/${draftAdvance.id}/finalise`)
    finalised.assertFlashMessage('error', it('flash.invoiceNotFinalisable.jobClosed'))
    await draftAdvance.refresh()
    assert.equal(draftAdvance.status, 'draft')
  })

  test('a finished, invoiced and paid Job has nothing left', async ({ client }) => {
    const office = await createUser('office')
    const { job } = await finishedJob()

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      leftToClose: { visits: 0, charges: 0, unpaid: 0, overpaid: 0, advances: 0, drafts: 0 },
      job: { indicators: { workComplete: true, invoiced: true, paid: true } },
    })
    const response = await post(client, office, `/jobs/${job.id}/close`)
    response.assertFlashMessage('success', it('flash.jobClosedNow', { number: job.number }))
  })

  test('a cancelled Job is neither closed nor reopened; a closed one is not cancelled', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const cancelled = await createJob(await createCustomer(), { status: 'cancelled' })
    for (const action of ['close', 'reopen']) {
      const response = await post(client, office, `/jobs/${cancelled.id}/${action}`)
      response.assertFlashMessage('error', it('flash.jobNotEditable'))
      await cancelled.refresh()
      assert.equal(cancelled.status, 'cancelled')
      assert.isNull(cancelled.closedAt)
    }

    const closed = await createJob(await createCustomer(), { status: 'closed' })
    const response = await post(client, office, `/jobs/${closed.id}/cancel`)
    response.assertFlashMessage('error', it('flash.jobClosed'))
    await closed.refresh()
    assert.equal(closed.status, 'closed')
    assert.isNull(closed.cancelledAt)
  })

  test('only Office and the Admin close and reopen Jobs', async ({ client, assert }) => {
    const job = await createJob(await createCustomer())
    const closed = await createJob(await createCustomer(), { status: 'closed' })
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of [`/jobs/${job.id}/close`, `/jobs/${closed.id}/reopen`]) {
        const response = await post(client, user, url)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    await job.refresh()
    await closed.refresh()
    assert.equal(job.status, 'open')
    assert.equal(closed.status, 'closed')
  })
})

test.group('A closed Job takes no new work', () => {
  test('no new Visits, Charges or Quotes, nor changes to its Visits', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const visit = await visitOf(job)
    await visit.related('technicians').attach([anna.id])
    const standard = await vatCode()
    const quote = await Quotes.create(job, {
      lines: [
        {
          kind: 'call_out',
          description: 'Uscita',
          quantity: '1',
          unitPrice: '35',
          vatCodeId: standard.id,
        },
      ],
    })
    await Quotes.send(quote)
    const accepted = await Quotes.create(job, {
      lines: [
        {
          kind: 'call_out',
          description: 'Extra',
          quantity: '1',
          unitPrice: '50',
          vatCodeId: standard.id,
        },
      ],
    })
    await Quotes.accept(accepted)
    await accepted.load('lines')
    await post(client, office, `/jobs/${job.id}/close`)

    const refusals: [ReturnType<typeof post>, string][] = [
      [
        client.post(`/jobs/${job.id}/visits`).json({
          date: '2026-11-10',
          startTime: '09:00',
          durationMinutes: 60,
          technicianIds: [anna.id],
        }),
        'flash.jobNotSchedulable',
      ],
      [
        client.put(`/visits/${visit.id}`).json({
          date: '2026-11-10',
          startTime: '09:00',
          durationMinutes: 60,
          technicianIds: [anna.id],
        }),
        'flash.visitNotEditable',
      ],
      [client.delete(`/visits/${visit.id}`), 'flash.visitNotEditable'],
      [
        client.patch(`/visits/${visit.id}/move`).json({ startsAt: '2026-11-10T09:00' }),
        'flash.visitNotMovable',
      ],
      [
        client.post(`/jobs/${job.id}/charges`).form({
          description: 'Uscita',
          quantity: '1',
          unitPrice: '35',
          vatKind: 'labour',
        }),
        'flash.chargeRefused.closed',
      ],
      [
        client.post(`/jobs/${job.id}/quotes`).json({
          lines: [
            {
              kind: 'call_out',
              description: 'Uscita',
              quantity: '1',
              unitPrice: '35',
              vatCodeId: standard.id,
            },
          ],
        }),
        'flash.quoteNotWritable',
      ],
      [client.post(`/quotes/${quote.id}/accept`), 'flash.quoteNotEditable'],
      [
        client
          .post(`/quotes/${accepted.id}/import`)
          .json({ lineIds: accepted.lines.map((line) => line.id) }),
        'flash.quoteImportRefused.closed',
      ],
    ]
    for (const [request, key] of refusals) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('error', it(key))
    }

    await visit.refresh()
    assert.equal(visit.startsAt.toISO(), DateTime.fromISO('2026-10-03T09:00').toISO())
    assert.lengthOf(await Visit.query().where('jobId', job.id), 1)
    assert.lengthOf(await Charge.query().where('jobId', job.id), 0)
    assert.lengthOf(await Quote.query().where('jobId', job.id), 2)
    await quote.refresh()
    assert.equal(quote.status, 'sent')
    await job.refresh()
    assert.equal(job.status, 'closed')

    const create = await client.get(`/jobs/${job.id}/quotes/create`).loginAs(office).redirects(0)
    create.assertFlashMessage('error', it('flash.quoteNotWritable'))
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canWriteQuote: false, canInvoiceAdvance: false })
  })

  test("its Visits stay on the Agenda, read-only, and leave the Technicians' lists", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const startsAt = DateTime.now().plus({ hours: 1 })
    const visit = await Visit.create({
      jobId: job.id,
      startsAt,
      endsAt: startsAt.plus({ hours: 1 }),
      status: 'planned',
    })
    await visit.related('technicians').attach([anna.id])
    // Needing another visit, with none planned after it
    const returning = await Visit.create({
      jobId: job.id,
      startsAt: startsAt.plus({ days: 1 }),
      endsAt: startsAt.plus({ days: 1, hours: 1 }),
      status: 'needs_return',
    })

    const shown = async () => {
      const agenda = await client
        .get('/agenda')
        .qs({ date: startsAt.toISODate() })
        .withInertia()
        .loginAs(office)
      const toSchedule = await client.get('/agenda/to-schedule').withInertia().loginAs(office)
      const mine = await client.get('/my-visits').withInertia().loginAs(anna)
      return [agenda, toSchedule, mine].map((page) =>
        (page.inertiaProps.visits as { id: number }[]).map((row) => row.id)
      )
    }
    assert.deepEqual(await shown(), [[visit.id], [returning.id], [visit.id]])

    await post(client, office, `/jobs/${job.id}/close`)
    // Still on the Agenda as history, but no longer movable
    assert.deepEqual(await shown(), [[visit.id], [], []])
    const agenda = await client
      .get('/agenda')
      .qs({ date: startsAt.toISODate() })
      .withInertia()
      .loginAs(office)
    agenda.assertInertiaPropsContains({ visits: [{ id: visit.id, movable: false }] })
  })

  test('Payments are still recorded on its Invoices, refunds too', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer())
    const invoice = await issued(job)
    await post(client, office, `/jobs/${job.id}/close`)

    for (const amount of ['150', '-28']) {
      const response = await client
        .post(`/invoices/${invoice.id}/payments`)
        .form({ amount, paidOn: DateTime.now().toISODate()! })
        .header('referer', `/invoices/${invoice.id}/edit`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      assert.notProperty(response.flashMessages() ?? {}, 'error')
    }
    const payments = await Payment.query().where('invoiceId', invoice.id).orderBy('id')
    assert.deepEqual(
      payments.map((payment) => payment.amount),
      ['150.00', '-28.00']
    )
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ job: { status: 'closed', indicators: { paid: true } } })
  })
})

test.group('Job indicators and the ready to close filter', () => {
  test('the page (TypeScript) and the filters (SQL) agree', async ({ client, assert }) => {
    const office = await createUser('office')
    const { job: ready } = await finishedJob()
    const { job: unpaid } = await finishedJob(false)
    const moreWork = await finishedJob()
    await visitOf(moreWork.job, {}, 7)
    const { job: closed } = await finishedJob()
    await post(client, office, `/jobs/${closed.id}/close`)
    const fresh = await createJob(await createCustomer())
    const overpaid = await finishedJob(false)
    await Payments.record(overpaid.invoice, { amount: '500', paidOn: DateTime.now() })
    const jobs = [ready, unpaid, moreWork.job, fresh, overpaid.job]

    const listed = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number }[]).map((row) => row.id).sort()
    }
    // Paid has no filter of its own: its SQL, straight
    const paidRows = await db.from('jobs').whereRaw(JOB_PAID_SQL).select('id')
    const filters = {
      workComplete: await listed('work_complete'),
      invoiced: await listed('invoiced'),
      paid: paidRows.map((row) => row.id as number),
      ready: await listed('ready_to_close'),
    }
    assert.deepEqual(filters.ready, [ready.id])

    for (const job of jobs) {
      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
      const { indicators } = page.inertiaProps.job as {
        indicators: { workComplete: boolean; invoiced: boolean; paid: boolean }
      }
      assert.equal(indicators.workComplete, filters.workComplete.includes(job.id), `${job.id}`)
      assert.equal(indicators.invoiced, filters.invoiced.includes(job.id), `${job.id}`)
      assert.equal(indicators.paid, filters.paid.includes(job.id), `${job.id}`)
      assert.equal(
        indicators.workComplete && indicators.invoiced && indicators.paid,
        filters.ready.includes(job.id),
        `${job.id}`
      )
    }
    // Shown on the closed Job too, though the filters only list active ones
    const page = await client.get(`/jobs/${closed.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      job: { status: 'closed', indicators: { workComplete: true, invoiced: true, paid: true } },
    })
    const list = await client.get('/jobs').qs({ status: 'closed' }).withInertia().loginAs(office)
    list.assertInertiaPropsContains({
      jobs: [{ id: closed.id, indicators: { workComplete: true, invoiced: true, paid: true } }],
    })
  })
})

test.group('Archiving and closed Jobs', () => {
  test('archiving needs every Job closed or cancelled', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()
    const closing = await createJob(customer, { siteId: site.id })
    await createJob(customer, { siteId: site.id, status: 'cancelled' })

    for (const url of [`/customers/${customer.id}/archive`, `/sites/${site.id}/archive`]) {
      const response = await post(client, office, url)
      response.assertFlashMessage('error', it('flash.hasOpenJobs'))
    }

    await post(client, office, `/jobs/${closing.id}/close`)
    const siteArchived = await post(client, office, `/sites/${site.id}/archive`)
    siteArchived.assertFlashMessage('success', it('flash.siteArchived'))
    const customerArchived = await post(client, office, `/customers/${customer.id}/archive`)
    customerArchived.assertFlashMessage('success', it('flash.customerArchived'))
    await customer.refresh()
    await site.refresh()
    assert.isNotNull(customer.archivedAt)
    assert.isNotNull(site.archivedAt)
  })

  test('a closed Job of an archived Customer or Site is reopened once it is restored', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()
    const job = await createJob(customer, { siteId: site.id, status: 'closed' })

    for (const [model, url] of [
      [customer, `/customers/${customer.id}`],
      [site, `/sites/${site.id}`],
    ] as const) {
      await post(client, office, `${url}/archive`)
      const refused = await post(client, office, `/jobs/${job.id}/reopen`)
      refused.assertFlashMessage('error', it('flash.jobReopenArchived'))
      await job.refresh()
      assert.equal(job.status, 'closed')
      await post(client, office, `${url}/restore`)
      await model.refresh()
      assert.isNull(model.archivedAt)
    }

    const reopened = await post(client, office, `/jobs/${job.id}/reopen`)
    reopened.assertFlashMessage('success', it('flash.jobReopened', { number: job.number }))
  })
})

test.group('Archiving and reopening concurrently', () => {
  test('a Job reopening while its Customer is archived: never both', async ({
    assert,
    cleanup,
  }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)

    for (let round = 0; round < 5; round++) {
      const customer = await createCustomer()
      const site = await createSite()
      const job = await createJob(customer, { siteId: site.id, status: 'closed' })

      // Separate pooled connections: real row locks, unlike the global transaction
      const [archived, reopened] = await Promise.allSettled([
        round % 2 ? Archiving.archiveSite(site.id) : Archiving.archiveCustomer(customer.id),
        Jobs.reopen(job.id),
      ])

      assert.notEqual(archived.status, reopened.status, `round ${round}`)
      if (archived.status === 'rejected') {
        assert.instanceOf(archived.reason, HasOpenJobsError)
      } else {
        assert.instanceOf((reopened as PromiseRejectedResult).reason, ArchivedRecordError)
      }
      const status = await db.from('jobs').where('id', job.id).select('status').firstOrFail()
      const [customerRow, siteRow] = await Promise.all([
        Customer.findOrFail(customer.id),
        Site.findOrFail(site.id),
      ])
      const archivedNow = Boolean(customerRow.archivedAt || siteRow.archivedAt)
      assert.equal(status.status, archivedNow ? 'closed' : 'open', `round ${round}`)
    }
  }).tags(['@committed'])

  test('closing locks the Job, then its Customer and Site, as archiving does', async ({
    assert,
    cleanup,
  }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)
    const customer = await createCustomer()
    const job = await createJob(customer)

    const [archived, closed] = await Promise.allSettled([
      Archiving.archiveCustomer(customer.id),
      Jobs.close(job.id),
    ])
    // Archiving may see the Job still open (refused) or already closed
    assert.equal(closed.status, 'fulfilled')
    if (archived.status === 'rejected') assert.instanceOf(archived.reason, HasOpenJobsError)
    const row = await Job.findOrFail(job.id)
    assert.equal(row.status, 'closed')
  }).tags(['@committed'])
})
