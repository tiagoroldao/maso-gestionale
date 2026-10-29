import { test } from '@japa/runner'
import Big from 'big.js'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import type Customer from '#models/customer'
import type User from '#models/user'
import Invoice from '#models/invoice'
import Payment from '#models/payment'
import Visit from '#models/visit'
import StockMovement from '#models/stock_movement'
import Invoices from '#services/invoices'
import Payments from '#services/payments'
import Submissions from '#services/submissions'
import { OWED_SQL } from '#services/job_status'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { createItem, vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { formatMoney } from '#shared/money'
import { formatDate } from '#shared/dates'
import { owed } from '#shared/payment_status'
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

/**
 * Posts a Payment (a refund when negative) as `user`.
 */
function pay(
  client: ApiClient,
  invoice: Invoice,
  user: User,
  amount: string,
  paidOn = DateTime.now().toISODate()!
) {
  return client
    .post(`/invoices/${invoice.id}/payments`)
    .form({ amount, paidOn })
    .header('referer', `/invoices/${invoice.id}/edit`)
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

/**
 * The amounts of the Invoice's Payments, in the order recorded.
 */
async function amountsOf(invoice: Invoice) {
  const payments = await Payment.query().where('invoiceId', invoice.id).orderBy('id')
  return payments.map((payment) => payment.amount)
}

/**
 * The warning shown for a Payment recorded with these `parts`.
 */
function warned(...parts: string[]) {
  return [it('flash.paymentWarning.recorded'), ...parts].join(' ')
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
          paymentSummary: {
            status: 'partly_paid',
            paid: '50.00',
            owed: '72.00',
            overpaidBy: null,
          },
        })
      }
    }

    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ paymentSummary: { status: 'paid', owed: '0.00' } })
    assert.lengthOf(await Payment.query().where('invoiceId', invoice.id), 2)
  })

  test('a Payment on a draft and an amount of zero are refused; a Payment can be removed', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const draft = await Invoices.create(await createCustomer())
    const invoice = await issued()

    const onDraft = await pay(client, draft, office, '10')
    onDraft.assertFlashMessage('error', it('flash.paymentRefused'))
    const refundOnDraft = await pay(client, draft, office, '-10')
    refundOnDraft.assertFlashMessage('error', it('flash.paymentRefused'))
    for (const amount of ['0', '-0,00']) {
      const zero = await pay(client, invoice, office, amount)
      assert.deepEqual(zero.flashMessage('inputErrorsBag'), {
        amount: [it('validator.shared.messages.amount.nonZero', { field: 'importo' })],
      })
    }
    assert.lengthOf(await Payment.all(), 0)

    const { payment } = await Payments.record(invoice, { amount: '22.00', paidOn: DateTime.now() })
    await client.delete(`/payments/${payment.id}`).withCsrfToken().loginAs(office)
    assert.lengthOf(await Payment.all(), 0)
  })

  test('checks, pages and list filters count Payments and Credit Notes alike', async ({
    assert,
  }) => {
    await completeCompany()
    const invoice = await issued()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'delivered' })
    await Payments.record(invoice, { amount: '100', paidOn: DateTime.now() })
    await Payments.record(invoice, { amount: '-10', paidOn: DateTime.now() })

    // Each way of reading what is owed: the checks', the page's, the filters'
    const readings = async () => {
      const checks = await db.transaction(async (trx) => ({
        paid: await Payments.paid(trx, invoice.id),
        credited: await Payments.credited(trx, invoice.id),
      }))
      const fresh = await Invoice.query()
        .where('id', invoice.id)
        .preload('payments')
        .preload('creditNotes')
        .firstOrFail()
      const { rows } = await db.rawQuery(
        `SELECT ${OWED_SQL('i')} AS owed FROM invoices i WHERE i.id = ?`,
        [invoice.id]
      )
      return {
        checks,
        page: { paid: fresh.paid, credited: fresh.credited },
        owed: [owed({ total: invoice.total!, ...checks }), new Big(rows[0].owed).toFixed(2)],
      }
    }
    // A draft Credit Note credits nothing yet
    const note = await Invoices.createCreditNote(invoice)
    assert.deepEqual(await readings(), {
      checks: { paid: '90.00', credited: '0.00' },
      page: { paid: '90.00', credited: '0.00' },
      owed: ['32.00', '32.00'],
    })
    await Invoices.finalise(note)
    assert.deepEqual(await readings(), {
      checks: { paid: '90.00', credited: '122.00' },
      page: { paid: '90.00', credited: '122.00' },
      owed: ['-90.00', '-90.00'],
    })
  })

  test('a Payment above what is owed is recorded with a warning; the Invoice is overpaid', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()

    const exact = await pay(client, invoice, office, '100')
    exact.assertFlashMessage('success', it('flash.paymentRecorded'))
    // 22.00 were left: 32,50 overpays by 10.50
    const over = await pay(client, invoice, office, '32,50')
    over.assertFlashMessage(
      'warning',
      warned(it('flash.paymentWarning.overpaid', { amount: formatMoney('10.50') }))
    )
    assert.include(it('flash.paymentWarning.overpaid', { amount: formatMoney('10.50') }), '10,50')
    assert.deepEqual(await amountsOf(invoice), ['100.00', '32.50'])

    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      paymentSummary: { status: 'overpaid', paid: '132.50', owed: '-10.50', overpaidBy: '10.50' },
    })
    // Another Payment on an overpaid Invoice is warned about too
    const again = await pay(client, invoice, office, '1')
    again.assertFlashMessage(
      'warning',
      warned(it('flash.paymentWarning.overpaid', { amount: formatMoney('11.50') }))
    )
  })

  test('a refund is a negative Payment, warned about beyond what was overpaid', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    await Payments.record(invoice, { amount: '142', paidOn: DateTime.now() })

    // 20.00 overpaid: refunding 15 is within it, and the Invoice stays overpaid
    const within = await pay(client, invoice, office, '-15')
    within.assertFlashMessage('success', it('flash.paymentRecorded'))
    // 5.00 left overpaid: refunding 8 gives back 3.00 too many
    const beyond = await pay(client, invoice, office, '-8,00')
    beyond.assertFlashMessage(
      'warning',
      warned(it('flash.paymentWarning.refundBeyondOverpaid', { amount: formatMoney('3.00') }))
    )
    assert.deepEqual(await amountsOf(invoice), ['142.00', '-15.00', '-8.00'])
    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      paymentSummary: { status: 'partly_paid', paid: '119.00', owed: '3.00', overpaidBy: null },
    })

    // Settled again; a refund on a settled Invoice is beyond what was overpaid
    const back = await pay(client, invoice, office, '3')
    back.assertFlashMessage('success', it('flash.paymentRecorded'))
    const settled = await pay(client, invoice, office, '-1')
    settled.assertFlashMessage(
      'warning',
      warned(it('flash.paymentWarning.refundBeyondOverpaid', { amount: formatMoney('1.00') }))
    )
  })

  test('a Payment dated before the Invoice is recorded with a warning', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    const issuedOn = invoice.issuedOn!.toISODate()!
    const before = invoice.issuedOn!.minus({ days: 3 }).toISODate()!

    const early = await pay(client, invoice, office, '50', before)
    early.assertFlashMessage(
      'warning',
      warned(it('flash.paymentWarning.beforeIssued', { date: formatDate(issuedOn) }))
    )
    // Both warnings when it also overpays
    const both = await pay(client, invoice, office, '80', before)
    both.assertFlashMessage(
      'warning',
      warned(
        it('flash.paymentWarning.overpaid', { amount: formatMoney('8.00') }),
        it('flash.paymentWarning.beforeIssued', { date: formatDate(issuedOn) })
      )
    )
    // On the day it was issued, no warning
    const sameDay = await pay(client, invoice, office, '-8', issuedOn)
    sameDay.assertFlashMessage('success', it('flash.paymentRecorded'))
    const payments = await Payment.query().where('invoiceId', invoice.id).orderBy('id')
    assert.deepEqual(
      payments.map((p) => [p.amount, p.paidOn.toISODate()]),
      [
        ['50.00', before],
        ['80.00', before],
        ['-8.00', issuedOn],
      ]
    )
  })

  test('removing a Payment is warned about, never refused, when it leaves the Invoice overpaid or owing', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    const remove = (payment: Payment) =>
      client
        .delete(`/payments/${payment.id}`)
        .header('referer', `/invoices/${invoice.id}/edit`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
    const removedWith = (part: string) =>
      [it('flash.paymentRemovedWarning.removed'), part].join(' ')

    // 122.00 paid twice: removing the duplicate settles it, no warning
    const { payment: first } = await Payments.record(invoice, {
      amount: '122',
      paidOn: DateTime.now(),
    })
    const { payment: twice } = await Payments.record(invoice, {
      amount: '122',
      paidOn: DateTime.now(),
    })
    const duplicate = await remove(twice)
    duplicate.assertFlashMessage('success', it('flash.paymentRemoved'))

    // A refund of 10 removed: the Invoice is overpaid by 10.00 again
    const { payment: refund } = await Payments.record(invoice, {
      amount: '10',
      paidOn: DateTime.now(),
    })
    const { payment: refunded } = await Payments.record(invoice, {
      amount: '-10',
      paidOn: DateTime.now(),
    })
    const overpaid = await remove(refunded)
    overpaid.assertFlashMessage(
      'warning',
      removedWith(it('flash.paymentRemovedWarning.overpaid', { amount: formatMoney('10.00') }))
    )
    await remove(refund)

    // The Payment that settled it removed: 122.00 owed again
    const owing = await remove(first)
    owing.assertFlashMessage(
      'warning',
      removedWith(it('flash.paymentRemovedWarning.owing', { amount: formatMoney('122.00') }))
    )
    assert.deepEqual(await amountsOf(invoice), [])
    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ paymentSummary: { status: 'unpaid', owed: '122.00' } })
  })

  test('the overdue list and the Customer balance', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const late = await issued(customer)
    const current = await issued(customer)
    const settled = await issued(customer)
    const overpaid = await issued(customer)
    await Payments.record(settled, { amount: '122', paidOn: DateTime.now() })
    await Payments.record(current, { amount: '22', paidOn: DateTime.now() })
    await Payments.record(overpaid, { amount: '130', paidOn: DateTime.now() })
    // Due dates in the past for three of them: an overpaid one isn't overdue
    for (const invoice of [late, settled, overpaid]) {
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
    // The filter (SQL) and the status shown (TypeScript) agree
    const overpaidList = await client
      .get('/invoices')
      .qs({ stage: 'overpaid' })
      .withInertia()
      .loginAs(office)
    assert.deepEqual(
      (overpaidList.inertiaProps.invoices as { id: number; payment: string }[]).map((i) => [
        i.id,
        i.payment,
      ]),
      [[overpaid.id, 'overpaid']]
    )
    const all = await client.get('/invoices').withInertia().loginAs(office)
    assert.sameDeepMembers(
      (all.inertiaProps.invoices as { id: number; payment: string }[])
        .filter((i) => ['overdue', 'overpaid'].includes(i.payment))
        .map((i) => [i.id, i.payment]),
      [
        [late.id, 'overdue'],
        [overpaid.id, 'overpaid'],
      ]
    )

    const page = await client.get(`/customers/${customer.id}`).withInertia().loginAs(office)
    // 122 (late) + 100 (current, 22 paid); the overpaid one is flagged,
    // not set against them
    page.assertInertiaPropsContains({
      balance: '222.00',
      overpaid: [{ id: overpaid.id, number: overpaid.formattedNumber, overpaidBy: '8.00' }],
    })
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

  test('a correction below what is already paid is saved with a warning; the Invoice is overpaid', async ({
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

    // Exactly what was paid: 81.97 + 22% = 100.00
    const exact = await client
      .put(`/invoices/${invoice.id}`)
      .json({
        lines: [
          { description: 'Intervento', quantity: '1', unitPrice: '81,97', vatCodeId: standard.id },
        ],
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    exact.assertFlashMessage('success', it('flash.invoiceSaved'))

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
    response.assertFlashMessage(
      'warning',
      it('flash.invoiceBelowPaid', { paid: formatMoney('100.00') })
    )
    // The literal amount, so a broken formatter can't pass unnoticed
    assert.include(it('flash.invoiceBelowPaid', { paid: formatMoney('100.00') }), '100,00')
    await invoice.refresh()
    assert.equal(invoice.total, '61.00')
    await invoice.load('lines')
    assert.equal(invoice.lines[0].unitPrice, '50.0000')
    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      paymentSummary: { status: 'overpaid', owed: '-39.00', overpaidBy: '39.00' },
    })
  })

  test('a correction below what is paid still rebooks its Items in stock', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const item = await createItem({ code: 'RUB-1' })
    const standard = await vatCode()
    const invoice = await Invoices.create(await createCustomer())
    const line = {
      itemId: item.id,
      description: 'Rubinetto',
      unitPrice: '50',
      vatCodeId: standard.id,
    }
    await Invoices.save(invoice, { lines: [{ ...line, quantity: '2' }] })
    await Invoices.finalise(invoice)
    await invoice.refresh()
    // 122.00 paid in full
    await Payments.record(invoice, { amount: invoice.total!, paidOn: DateTime.now() })
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })

    const response = await client
      .put(`/invoices/${invoice.id}`)
      .json({ lines: [{ ...line, quantity: '1' }] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage(
      'warning',
      it('flash.invoiceBelowPaid', { paid: formatMoney('122.00') })
    )
    const movements = await StockMovement.query().where('itemId', item.id).orderBy('id')
    assert.deepEqual(
      movements.map((m) => [m.kind, m.quantity]),
      [
        ['sale', '-2.000'],
        ['adjustment', '1.000'],
      ]
    )
  })

  test('Jobs show as invoiced, then paid, but only Office closes them; archiving follows', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const job = await createJob(customer)
    const invoice = await issued(customer, job.id)

    type Row = { id: number; status: string; indicators: { invoiced: boolean; paid: boolean } }
    const ids = async (status?: string) => {
      const list = await client
        .get('/jobs')
        .qs(status ? { status } : {})
        .withInertia()
        .loginAs(office)
      return (list.inertiaProps.jobs as Row[]).map((j) => [
        j.id,
        j.status,
        j.indicators.invoiced,
        j.indicators.paid,
      ])
    }
    assert.deepEqual(await ids('invoiced'), [[job.id, 'open', true, false]])
    assert.deepEqual(await ids('open'), [[job.id, 'open', true, false]])
    const archive = await client
      .post(`/customers/${customer.id}/archive`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    archive.assertFlashMessage('error', it('flash.hasOpenJobs'))

    // Overpaid isn't settled: not paid
    await Payments.record(invoice, { amount: '130', paidOn: DateTime.now() })
    assert.deepEqual(await ids('invoiced'), [[job.id, 'open', true, false]])
    assert.deepEqual(await ids('closed'), [])
    const notYet = await client
      .post(`/customers/${customer.id}/archive`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    notYet.assertFlashMessage('error', it('flash.hasOpenJobs'))

    // Refunding what was overpaid settles it: paid, yet still open (ADR 0015)
    await Payments.record(invoice, { amount: '-8', paidOn: DateTime.now() })
    assert.deepEqual(await ids(), [[job.id, 'open', true, true]])
    assert.deepEqual(await ids('closed'), [])
    const stillOpen = await client
      .post(`/customers/${customer.id}/archive`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    stillOpen.assertFlashMessage('error', it('flash.hasOpenJobs'))

    // Office closes it: the active list leaves it out
    await client.post(`/jobs/${job.id}/close`).withCsrfToken().loginAs(office)
    assert.deepEqual(await ids('closed'), [[job.id, 'closed', true, true]])
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
      const job = await createJob(customer, { status: 'in_progress' })
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
      return (list.inertiaProps.jobs as { id: number }[]).map((j) => j.id).sort()
    }
    assert.deepEqual(await ids('invoiced'), [billed.id])
    assert.deepEqual(await ids('work_complete'), [billed.id, drafted.id].sort())
    assert.deepEqual(await ids('in_progress'), [billed.id, drafted.id].sort())
    assert.deepEqual(await ids('ready_to_close'), [])
    assert.deepEqual(await ids('closed'), [])
  })

  test('Technicians and the Superuser can not record or remove Payments', async ({
    client,
    assert,
  }) => {
    await completeCompany()
    const invoice = await issued()
    const { payment } = await Payments.record(invoice, { amount: '10', paidOn: DateTime.now() })
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      // A Payment, one that overpays, and a refund
      for (const request of [
        ...['5', '500', '-5'].map((amount) =>
          client
            .post(`/invoices/${invoice.id}/payments`)
            .form({ amount, paidOn: DateTime.now().toISODate()! })
        ),
        client.delete(`/payments/${payment.id}`),
      ]) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
      // Nor see the overpaid list
      const list = await client
        .get('/invoices')
        .qs({ stage: 'overpaid' })
        .withInertia()
        .loginAs(user)
      list.assertStatus(403)
    }
    assert.lengthOf(await Payment.all(), 1)
  })

  test('Admins record Payments, overpayments and refunds too', async ({ client, assert }) => {
    const admin = await createUser('admin')
    await completeCompany()
    const invoice = await issued()
    const paid = await pay(client, invoice, admin, '100')
    paid.assertFlashMessage('success', it('flash.paymentRecorded'))
    const over = await pay(client, invoice, admin, '30')
    over.assertFlashMessage(
      'warning',
      warned(it('flash.paymentWarning.overpaid', { amount: formatMoney('8.00') }))
    )
    const overpaid = await client
      .get('/invoices')
      .qs({ stage: 'overpaid' })
      .withInertia()
      .loginAs(admin)
    overpaid.assertInertiaPropsContains({ invoices: [{ id: invoice.id, payment: 'overpaid' }] })
    const refund = await pay(client, invoice, admin, '-8')
    refund.assertFlashMessage('success', it('flash.paymentRecorded'))
    assert.lengthOf(await Payment.query().where('invoiceId', invoice.id), 3)
  })
})
