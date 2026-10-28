import { test } from '@japa/runner'
import Invoice from '#models/invoice'
import StockMovement from '#models/stock_movement'
import LabourRate from '#models/labour_rate'
import Invoices from '#services/invoices'
import Quotes from '#services/quotes'
import Submissions from '#services/submissions'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * A Quoted Job with an accepted Quote: a boiler at 10%, labour under
 * reverse charge, and a text line.
 */
async function acceptedJob() {
  const customer = await createCustomer({ name: 'Condominio Verdi' })
  const job = await createJob(customer, { kind: 'quoted' })
  const item = await createItem({ unit: 'pz' })
  const rate =
    (await LabourRate.findBy('name', 'Idraulico')) ??
    (await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' }))
  const reduced = await vatCode('10%')
  const reverse = await vatCode('Inversione contabile – impianti su edifici')
  await Quotes.save(job, {
    notes: 'Validità 30 giorni',
    lines: [
      {
        kind: 'item',
        itemId: item.id,
        description: 'Caldaia',
        quantity: '1',
        unitPrice: '1500',
        vatCodeId: reduced.id,
      },
      {
        kind: 'labour',
        labourRateId: rate.id,
        description: 'Posa',
        quantity: '4',
        unitPrice: '40',
        vatCodeId: reverse.id,
      },
      { kind: 'text', description: 'Smaltimento incluso' },
    ],
  })
  await Quotes.accept(job)
  await job.refresh()
  return { job, item, reduced, customer }
}

test.group('Invoices from Quoted Jobs', () => {
  test('the draft mirrors the accepted Quote, with the VAT it was accepted with', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { job, item, reduced } = await acceptedJob()
    // Changed after acceptance: the Invoice still follows the Quote
    reduced.rate = '11'
    await reduced.save()

    const response = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    const invoice = await Invoice.query()
      .where('jobId', job.id)
      .preload('lines', (l) => l.orderBy('position'))
      .firstOrFail()
    response.assertHeader('location', `/invoices/${invoice.id}/edit`)
    assert.equal(invoice.customerId, job.customerId)
    assert.equal(invoice.status, 'draft')
    assert.deepEqual(
      invoice.lines.map((line) => [
        line.itemId,
        line.description,
        line.quantity,
        line.unitPrice,
        line.vatRate,
        line.natura,
      ]),
      [
        [item.id, 'Caldaia', '1.000', '1500.0000', '10.00', null],
        [null, 'Posa', '4.000', '40.0000', '0.00', 'N6.7'],
      ]
    )
    assert.equal(invoice.notes, 'Validità 30 giorni\nSmaltimento incluso')
    // 1500 + 150 VAT + 160 reverse charge
    assert.equal(invoice.totals.total, '1810.00')

    // Pressing again opens the same draft
    const again = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertHeader('location', `/invoices/${invoice.id}/edit`)
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 1)
  })

  test('only a Quoted Job with an accepted Quote can be invoiced this way', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { kind: 'quoted' })

    const response = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    assert.lengthOf(await Invoice.all(), 0)
  })

  test('the Quote is invoiced once, and never for a cancelled Job', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const { job } = await acceptedJob()
    const invoice = await Invoices.fromQuote(job)
    await Invoices.finalise(invoice)

    // Finalised already: pressing again opens it, no second copy
    const again = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertHeader('location', `/invoices/${invoice.id}/edit`)
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 1)
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })

    const other = await acceptedJob()
    await client.post(`/jobs/${other.job.id}/cancel`).withCsrfToken().loginAs(office)
    const cancelled = await client
      .post(`/jobs/${other.job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    cancelled.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    assert.lengthOf(await Invoice.query().where('jobId', other.job.id), 0)
    const cancelledPage = await client.get(`/jobs/${other.job.id}`).withInertia().loginAs(office)
    cancelledPage.assertInertiaPropsContains({ canInvoice: false })
  })

  test('correcting a rejected Job Invoice moves no stock; labour keeps its unit', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { job, item, reduced } = await acceptedJob()
    const invoice = await Invoices.fromQuote(job)
    await Invoices.finalise(invoice)
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })
    await invoice.load('lines', (l) => l.orderBy('position'))
    const [boiler, labour] = invoice.lines

    await client
      .put(`/invoices/${invoice.id}`)
      .json({
        lines: [
          {
            itemId: item.id,
            description: boiler.description,
            quantity: '2',
            unitPrice: '1500',
            vatCodeId: reduced.id,
          },
          {
            description: labour.description,
            unit: labour.unit,
            quantity: '4',
            unitPrice: '40',
            vatCodeId: labour.vatCodeId,
          },
        ],
      })
      .withCsrfToken()
      .loginAs(office)

    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 0)
    await invoice.load('lines', (l) => l.orderBy('position'))
    assert.equal(invoice.lines[1].unit, 'h')
  })

  test("a Job's Invoice takes nothing off stock: its Visits did", async ({ assert }) => {
    await completeCompany()
    const { job, item } = await acceptedJob()
    const invoice = await Invoices.fromQuote(job)

    await Invoices.finalise(invoice)

    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 0)
  })

  test('an invoiced Job keeps its Customer and can not be cancelled', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { job } = await acceptedJob()
    await Invoices.fromQuote(job)
    const other = await createCustomer({ name: 'Altro' })

    const moved = await client
      .put(`/jobs/${job.id}`)
      .form({
        customerId: String(other.id),
        kind: 'quoted',
        workCategory: 'maintenance',
        title: 'Nuovo titolo',
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    moved.assertFlashMessage('error', it('flash.jobCustomerInvoiced'))

    const renamed = await client
      .put(`/jobs/${job.id}`)
      .form({
        customerId: String(job.customerId),
        kind: 'quoted',
        workCategory: 'maintenance',
        title: 'Nuovo titolo',
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    renamed.assertFlashMessage('success', it('flash.jobSaved', { number: job.number }))

    const cancelled = await client
      .post(`/jobs/${job.id}/cancel`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    cancelled.assertFlashMessage('error', it('flash.jobInvoiced'))
    await job.refresh()
    assert.equal(job.title, 'Nuovo titolo')
    assert.notEqual(job.status, 'cancelled')
  })

  test('the Job page lists its Invoices and offers the Quote', async ({ client }) => {
    const office = await createUser('office')
    const { job } = await acceptedJob()

    const before = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    before.assertInertiaPropsContains({ canInvoice: true, invoices: [] })

    const invoice = await Invoices.fromQuote(job)
    const after = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    after.assertInertiaPropsContains({ invoices: [{ id: invoice.id, status: 'draft' }] })
  })

  test('Technicians and the Superuser can not create Invoices from Jobs', async ({
    client,
    assert,
  }) => {
    const { job } = await acceptedJob()
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      const response = await client
        .post(`/jobs/${job.id}/invoices`)
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await Invoice.all(), 0)
  })
})
