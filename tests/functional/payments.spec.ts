import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type Customer from '#models/customer'
import Invoice from '#models/invoice'
import Payment from '#models/payment'
import Visit from '#models/visit'
import Invoices from '#services/invoices'
import Payments from '#services/payments'
import Submissions from '#services/submissions'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * A finalised Invoice of 122.00 (100 + 22% VAT), optionally for a Job.
 */
async function issued(customer?: Customer, jobId?: number) {
  const invoice = await Invoices.create(customer ?? (await createCustomer()))
  if (jobId) await invoice.merge({ jobId }).save()
  const standard = await vatCode()
  await Invoices.save(invoice, {
    lines: [{ description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id }],
  })
  await Invoices.finalise(invoice)
  await invoice.refresh()
  return invoice
}

test.group('Payments', () => {
  test('several Payments settle an Invoice; its status follows them', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    assert.equal(invoice.total, '122.00')

    for (const amount of ['50', '72,00']) {
      const response = await client
        .post(`/invoices/${invoice.id}/payments`)
        .form({ amount, paidOn: DateTime.now().toISODate()!, note: 'Bonifico' })
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('success', it('flash.paymentRecorded'))
      if (amount === '50') {
        const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
        page.assertInertiaPropsContains({
          paymentSummary: { status: 'partly_paid', paid: '50.00', outstanding: '72.00' },
        })
      }
    }

    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ paymentSummary: { status: 'paid', outstanding: '0.00' } })
    assert.lengthOf(await Payment.query().where('invoiceId', invoice.id), 2)
  })

  test('drafts and amounts above what is owed are refused; a Payment can be removed', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const draft = await Invoices.create(await createCustomer())
    const invoice = await issued()
    const today = DateTime.now().toISODate()!

    const onDraft = await client
      .post(`/invoices/${draft.id}/payments`)
      .form({ amount: '10', paidOn: today })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    onDraft.assertFlashMessage('error', it('flash.paymentRefused.draft'))
    const tooMuch = await client
      .post(`/invoices/${invoice.id}/payments`)
      .form({ amount: '122,01', paidOn: today })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    tooMuch.assertFlashMessage('error', it('flash.paymentRefused.tooMuch'))
    const zero = await client
      .post(`/invoices/${invoice.id}/payments`)
      .form({ amount: '0', paidOn: today })
      .header('referer', `/invoices/${invoice.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(zero.flashMessage('inputErrorsBag'), ['amount'])
    assert.lengthOf(await Payment.all(), 0)

    const payment = await Payments.record(invoice, { amount: '22.00', paidOn: DateTime.now() })
    await client.delete(`/payments/${payment.id}`).withCsrfToken().loginAs(office)
    assert.lengthOf(await Payment.all(), 0)
  })

  test('the overdue list and the Customer balance', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const late = await issued(customer)
    const current = await issued(customer)
    const settled = await issued(customer)
    await Payments.record(settled, { amount: '122', paidOn: DateTime.now() })
    await Payments.record(current, { amount: '22', paidOn: DateTime.now() })
    // Due dates in the past for two of them
    for (const invoice of [late, settled]) {
      await Invoice.query()
        .where('id', invoice.id)
        .update({ due_on: DateTime.now().minus({ days: 3 }).toISODate() })
    }

    const list = await client
      .get('/invoices')
      .qs({ stage: 'overdue' })
      .withInertia()
      .loginAs(office)
    assert.deepEqual(
      (list.inertiaProps.invoices as { id: number; payment: string }[]).map((i) => [
        i.id,
        i.payment,
      ]),
      [[late.id, 'overdue']]
    )
    const page = await client.get(`/customers/${customer.id}`).withInertia().loginAs(office)
    // 122 (late) + 100 (current, 22 paid)
    page.assertInertiaPropsContains({ balance: '222.00' })
  })

  test('a corrected rejected Invoice keeps its total in step with its lines', async ({
    assert,
  }) => {
    await completeCompany()
    const invoice = await issued()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })
    const standard = await vatCode()

    await Invoices.save(invoice, {
      lines: [
        { description: 'Intervento', quantity: '2', unitPrice: '100', vatCodeId: standard.id },
      ],
    })

    await invoice.refresh()
    assert.equal(invoice.total, '244.00')
  })

  test('a correction can not bring the total below what is already paid', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    await Payments.record(invoice, { amount: '100', paidOn: DateTime.now() })
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })
    const standard = await vatCode()

    // 50 + 22% = 61.00, below the 100.00 paid
    const response = await client
      .put(`/invoices/${invoice.id}`)
      .json({
        lines: [
          { description: 'Intervento', quantity: '1', unitPrice: '50', vatCodeId: standard.id },
        ],
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('error', it('flash.invoiceBelowPaid', { paid: 100 }))
    assert.include(it('flash.invoiceBelowPaid', { paid: 100 }), '100,00')
    await invoice.refresh()
    assert.equal(invoice.total, '122.00')
    await invoice.load('lines')
    assert.equal(invoice.lines[0].unitPrice, '100.0000')

    // Exactly what was paid is fine: 81.97 + 22% = 100.00
    await Invoices.save(invoice, {
      lines: [
        { description: 'Intervento', quantity: '1', unitPrice: '81.97', vatCodeId: standard.id },
      ],
    })
    await invoice.refresh()
    assert.equal(invoice.total, '100.00')
  })

  test('Jobs become Invoiced, then Closed; the lists and archiving follow', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const job = await createJob(customer, { kind: 'quoted', status: 'accepted' })
    const invoice = await issued(customer, job.id)

    const ids = async (status?: string) => {
      const list = await client
        .get('/jobs')
        .qs(status ? { status } : {})
        .withInertia()
        .loginAs(office)
      return (list.inertiaProps.jobs as { id: number; status: string }[]).map((j) => [
        j.id,
        j.status,
      ])
    }
    assert.deepEqual(await ids('invoiced'), [[job.id, 'invoiced']])
    assert.deepEqual(await ids('accepted'), [])
    const archive = await client
      .post(`/customers/${customer.id}/archive`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    archive.assertFlashMessage('error', it('flash.hasOpenJobs'))

    await Payments.record(invoice, { amount: '122', paidOn: DateTime.now() })
    assert.deepEqual(await ids('closed'), [[job.id, 'closed']])
    // The active list leaves Closed Jobs out
    assert.deepEqual(await ids(), [])
    const archived = await client
      .post(`/customers/${customer.id}/archive`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    archived.assertFlashMessage('success', it('flash.customerArchived'))
  })

  test('finished work counts as Invoiced only once an Invoice is issued', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const finishedWork = async () => {
      const job = await createJob(customer, { kind: 'time_and_materials', status: 'in_progress' })
      const startsAt = DateTime.now().minus({ days: 1 })
      await Visit.create({
        jobId: job.id,
        startsAt,
        endsAt: startsAt.plus({ hours: 2 }),
        status: 'done',
      })
      return job
    }
    // An issued Invoice, partly paid; and one still a draft
    const billed = await finishedWork()
    const partly = await issued(customer, billed.id)
    await Payments.record(partly, { amount: '22', paidOn: DateTime.now() })
    const drafted = await finishedWork()
    const draft = await Invoices.create(customer)
    await draft.merge({ jobId: drafted.id }).save()

    const ids = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number; status: string }[])
        .map((j) => [j.id, j.status])
        .sort()
    }
    assert.deepEqual(await ids('invoiced'), [[billed.id, 'invoiced']])
    assert.deepEqual(await ids('work_complete'), [[drafted.id, 'work_complete']])
    assert.deepEqual(await ids('in_progress'), [])
    assert.deepEqual(await ids('closed'), [])
  })

  test('Technicians and the Superuser can not record or remove Payments', async ({
    client,
    assert,
  }) => {
    await completeCompany()
    const invoice = await issued()
    const payment = await Payments.record(invoice, { amount: '10', paidOn: DateTime.now() })
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const request of [
        client
          .post(`/invoices/${invoice.id}/payments`)
          .form({ amount: '5', paidOn: DateTime.now().toISODate()! }),
        client.delete(`/payments/${payment.id}`),
      ]) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.lengthOf(await Payment.all(), 1)
  })
})
