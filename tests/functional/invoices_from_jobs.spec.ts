import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import StockMovement from '#models/stock_movement'
import LabourRate from '#models/labour_rate'
import Invoices from '#services/invoices'
import Quotes from '#services/quotes'
import Submissions from '#services/submissions'
import Charges from '#services/charges'
import VatDefaults from '#services/vat_defaults'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import { confirmUsed } from '#tests/helpers/charges'

/**
 * A Job with an accepted Quote (a boiler at 10%, labour under reverse
 * charge, and a text line), its lines imported onto the Job as Charges
 * unless `imported` is false (ADR 0012), and confirmed used unless `used`
 * is false (ADR 0016).
 */
async function acceptedJob({ imported = true, used = true } = {}) {
  const customer = await createCustomer({ name: 'Condominio Verdi' })
  const job = await createJob(customer, { workCategory: 'sale' })
  const item = await createItem({ unit: 'pz' })
  const rate =
    (await LabourRate.findBy('name', 'Idraulico')) ??
    (await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' }))
  const reduced = await vatCode('10%')
  const reverse = await vatCode('Inversione contabile – impianti su edifici')
  const quote = await Quotes.create(job, {
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
  await Quotes.accept(quote)
  await job.refresh()
  if (imported) {
    await quote.load('lines')
    await Quotes.importLines(
      quote,
      { lineIds: quote.lines.map((line) => line.id), workerName: 'Ditta Rossi' },
      await createUser('office')
    )
    if (used) await confirmUsed(job.id)
  }
  return { job, item, reduced, customer, quote }
}

test.group('Invoices from Jobs with a Quote', () => {
  test('the draft bills the imported Charges at the VAT the Customer accepted', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { job, item } = await acceptedJob()

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
    assert.equal(invoice.status, 'draft')
    // Priced as quoted, at the Quote's VAT (10%, reverse charge) rather
    // than the Job's defaults; the text line and the Quote's notes stay on it
    const defaults = await VatDefaults.forJob(job)
    assert.notEqual(defaults.labour.natura, 'N6.7')
    assert.notEqual(defaults.material.rate, '10.00')
    assert.deepEqual(
      invoice.lines.map((line) => [
        line.itemId,
        line.description,
        line.quantity,
        line.unit,
        line.unitPrice,
        line.vatRate,
        line.natura,
      ]),
      [
        [item.id, 'Caldaia', '1.000', 'pz', '1500.0000', '10.00', null],
        [null, 'Posa', '4.000', 'h', '40.0000', '0.00', 'N6.7'],
      ]
    )
    assert.isNull(invoice.notes)

    // Pressing again opens the same draft
    const again = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertHeader('location', `/invoices/${invoice.id}/edit`)
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 1)
  })

  test("a Quote line's VAT Code archived since falls back to the Job's default", async ({
    assert,
  }) => {
    const { job, reduced } = await acceptedJob()
    reduced.archivedAt = DateTime.now()
    await reduced.save()

    const invoice = await Invoices.fromJob(job)

    const defaults = await VatDefaults.forJob(job)
    await invoice.load('lines', (l) => l.orderBy('position'))
    assert.deepEqual(
      invoice.lines.map((line) => [line.vatCodeId, line.natura]),
      [
        [defaults.material.id, defaults.material.natura],
        [invoice.lines[1].vatCodeId, 'N6.7'],
      ]
    )
    assert.notEqual(invoice.lines[0].vatCodeId, reduced.id)
  })

  test('an accepted Quote alone is not billable: nothing imported, nothing to invoice', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { job } = await acceptedJob({ imported: false })

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false, canInvoiceAdvance: true })
    const response = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    assert.lengthOf(await Invoice.all(), 0)
  })

  test('the Job shows the Quote total next to what is invoiced, for comparison', async ({
    client,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { job } = await acceptedJob()
    const invoice = await Invoices.fromJob(job)
    // Billed for less than quoted: the Quote doesn't bind the bill
    await invoice.load('lines', (l) => l.orderBy('position'))
    await Invoices.save(invoice, {
      lines: invoice.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId ?? undefined,
        unit: line.unit ?? undefined,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.itemId ? '1400' : line.unitPrice,
        vatCodeId: line.vatCodeId,
      })),
    })
    await Invoices.finalise(invoice)

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      canInvoice: false,
      invoicedSoFar: { amount: '1560.00', of: '1560.00', quoted: '1660.00' },
      job: { indicators: { invoiced: true } },
    })
  })

  test('the comparison sums every accepted Quote of the Job, and only those', async ({
    client,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { job } = await acceptedJob({ imported: false })
    const standard = await vatCode()
    const extra = (unitPrice: string) =>
      Quotes.create(job, {
        lines: [
          {
            kind: 'call_out',
            description: 'Lavori extra',
            quantity: '1',
            unitPrice,
            vatCodeId: standard.id,
          },
        ],
      })
    await Quotes.accept(await extra('200'))
    await Quotes.decline(await extra('5000'))
    await Quotes.send(await extra('7000'))
    await extra('9000')
    const invoice = await Invoices.createAdvance(job)
    await invoice.load('lines')
    await Invoices.save(invoice, {
      lines: invoice.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: '1',
        unitPrice: '100',
        vatCodeId: line.vatCodeId,
      })),
    })
    await Invoices.finalise(invoice)

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    // 1,660.00 and 200.00 accepted; the declined, sent and draft ones not
    page.assertInertiaPropsContains({ invoicedSoFar: { amount: '100.00', quoted: '1860.00' } })
  })

  test('a Job with a Quote is invoiced again for Charges added later', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { job } = await acceptedJob()
    const invoice = await Invoices.fromJob(job)
    await Invoices.finalise(invoice)
    let page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false, job: { indicators: { invoiced: true } } })

    await Charges.add(
      job,
      { description: 'Extra', quantity: '1', unit: null, unitPrice: '80', vatKind: 'labour' },
      office
    )
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      canInvoice: true,
      job: { status: 'open', indicators: { invoiced: false } },
    })
    const second = await Invoices.fromJob(job)
    assert.notEqual(second.id, invoice.id)
  })

  test('a {$self} Job still invoices the work recorded on it (#111)')
    .with(['closed', 'cancelled'] as const)
    .run(async ({ client, assert }, status) => {
      const office = await createUser('office')
      const { job } = await acceptedJob()
      await client
        .post(`/jobs/${job.id}/${status === 'closed' ? 'close' : 'cancel'}`)
        .withCsrfToken()
        .loginAs(office)
      await job.refresh()
      assert.equal(job.status, status)

      const before = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
      before.assertInertiaPropsContains({ canInvoice: true, canInvoiceAdvance: false })
      const drafted = await client
        .post(`/jobs/${job.id}/invoices`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      drafted.assertFlashMessage('success', it('flash.invoiceCreated'))
      const invoice = await Invoice.query().where('jobId', job.id).preload('lines').firstOrFail()
      assert.equal(invoice.status, 'draft')
      assert.isAbove(invoice.lines.length, 0)
      await job.refresh()
      assert.equal(job.status, status)
    })

  test('correcting a rejected Job Invoice moves no stock; labour keeps its unit', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { job, item, reduced } = await acceptedJob()
    const invoice = await Invoices.fromJob(job)
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

    // Only the usage when Office confirmed it used (ADR 0016)
    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 1)
    await invoice.load('lines', (l) => l.orderBy('position'))
    assert.equal(invoice.lines[1].unit, 'h')
  })

  test("a Job's Invoice takes nothing off stock: confirming it used did", async ({ assert }) => {
    await completeCompany()
    const { job, item } = await acceptedJob()
    const used = await StockMovement.query().where('itemId', item.id)
    assert.deepEqual(
      used.map((movement) => [movement.kind, movement.quantity, movement.reference]),
      [['usage', '-1.000', job.number]]
    )
    const invoice = await Invoices.fromJob(job)

    await Invoices.finalise(invoice)

    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 1)
  })

  test('an invoiced Job keeps its Customer and can not be cancelled', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { job } = await acceptedJob()
    await Invoices.fromJob(job)
    const other = await createCustomer({ name: 'Altro' })

    const moved = await client
      .put(`/jobs/${job.id}`)
      .form({
        customerId: String(other.id),
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

  test('the Job page lists its Invoices and offers the draft', async ({ client }) => {
    const office = await createUser('office')
    const { job } = await acceptedJob()

    const before = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    before.assertInertiaPropsContains({ canInvoice: true, invoices: [] })

    const invoice = await Invoices.fromJob(job)
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
