import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import type Customer from '#models/customer'
import type User from '#models/user'
import Invoice from '#models/invoice'
import InvoiceSubmission from '#models/invoice_submission'
import Payment from '#models/payment'
import Charges from '#services/charges'
import Invoices from '#services/invoices'
import Payments from '#services/payments'
import Submissions, { SubmissionRefusedError } from '#services/submissions'
import { fatturaInputFor } from '#fiscal/fattura_pa'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { createCustomer, defaultPaymentTerms } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import { formatMoney } from '#shared/money'
import { formatDate } from '#shared/dates'
import type { ScreenAction } from '#shared/screen_actions'

const pdf = app.makePath('tests/fixtures/manual.pdf')
const notPdf = app.makePath('tests/fixtures/logo.png')
const today = () => DateTime.now().toISODate()!
const daysAgo = (days: number) => DateTime.now().minus({ days }).toISODate()!

type Fields = Record<string, string | number | boolean | undefined>

/**
 * Posts the Legacy Invoice form (to `url`) as `user`, with `fields` and,
 * unless `file` is null, a PDF. VAT rows go as `vatRows[i][...]`.
 */
function post(
  client: ApiClient,
  user: User,
  fields: Fields,
  options: {
    url?: string
    file?: string | null
    vatRows?: { vatCodeId: number; taxable: string }[]
  } = {}
) {
  let request = client.post(options.url ?? '/invoices/legacy')
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) request = request.field(name, String(value))
  }
  for (const [index, row] of (options.vatRows ?? []).entries()) {
    request = request
      .field(`vatRows[${index}][vatCodeId]`, String(row.vatCodeId))
      .field(`vatRows[${index}][taxable]`, row.taxable)
  }
  const file = options.file === undefined ? pdf : options.file
  if (file) request = request.file('pdf', file)
  return request
    .header('referer', '/invoices/legacy/create')
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

/**
 * A Legacy Invoice of 122.00 (100 + 22) for `customer`, as Office enters it.
 */
function legacyFields(customer: Customer, overrides: Fields = {}): Fields {
  return {
    customerId: customer.id,
    number: '125/2025',
    issuedOn: '2025-11-03',
    taxable: '100,00',
    vat: '22,00',
    total: '122,00',
    ...overrides,
  }
}

async function created(response: { assertStatus: (status: number) => void }, number: string) {
  response.assertStatus(302)
  return Invoice.query().where('documentType', 'legacy').where('legacyNumber', number).firstOrFail()
}

/**
 * A Job without a Quote (a sale: 22% on labour), with a cost to bill.
 */
async function jobWithCost(customer: Customer, price: string) {
  const office = await createUser('office')
  const job = await createJob(customer, { status: 'in_progress', workCategory: 'sale' })
  await Charges.add(
    job,
    { description: 'Lavori', quantity: '1', unit: null, unitPrice: price, vatKind: 'labour' },
    office
  )
  return job
}

async function enter(
  client: ApiClient,
  fields: Fields,
  vatRows?: { vatCodeId: number; taxable: string }[]
) {
  const office = await createUser('office')
  const response = await post(client, office, fields, { vatRows })
  return created(response, String(fields.number))
}

/** Every route a Legacy Invoice has, as [method, url] */
function routes(invoice: Invoice | null) {
  const id = invoice?.id ?? 0
  return [
    ['get', '/invoices/legacy/create'],
    ['post', '/invoices/legacy'],
    ['get', `/invoices/${id}/legacy`],
    ['post', `/invoices/${id}/legacy`],
    ['delete', `/invoices/${id}/legacy`],
    ['get', `/invoices/${id}/legacy/pdf`],
  ] as const
}

test.group('Legacy Invoices', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office records one with its PDF; it is a delivered Invoice outside the SDI flow', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const terms = await defaultPaymentTerms()

    const form = await client
      .get('/invoices/legacy/create')
      .qs({ customerId: customer.id })
      .withInertia()
      .loginAs(office)
    form.assertInertiaComponent('invoices/legacy')
    form.assertInertiaPropsContains({ customer: { id: customer.id }, invoice: null })

    const response = await post(client, office, legacyFields(customer))
    const invoice = await created(response, '125/2025')
    response.assertHeader('location', `/invoices/${invoice.id}/legacy`)
    response.assertFlashMessage('success', it('flash.legacyInvoiceCreated'))
    assert.equal(invoice.status, 'delivered')
    assert.equal(invoice.formattedNumber, '125/2025')
    assert.isNull(invoice.number)
    assert.isNull(invoice.series)
    assert.equal(invoice.issuedOn!.toISODate(), '2025-11-03')
    // No due date given: the Customer's Payment Terms
    assert.equal(
      invoice.dueOn!.toISODate(),
      terms.dueDate(DateTime.fromISO('2025-11-03')).toISODate()
    )
    assert.deepEqual([invoice.taxable, invoice.vat, invoice.total], ['100.00', '22.00', '122.00'])
    assert.isFalse(invoice.advance)
    assert.equal(invoice.pdfName, 'manual.pdf')
    assert.match(invoice.pdfPath!, /^invoices\/legacy\/[0-9a-f-]+\.pdf$/)
    assert.isTrue(existsSync(storagePath(invoice.pdfPath!)))
    assert.lengthOf(await Payment.query().where('invoiceId', invoice.id), 0)
    // It doesn't touch the Invoice numbering
    assert.deepEqual(await Invoices.numbering(2025), { year: 2025, nextNumber: 1, locked: false })

    const page = await client.get(`/invoices/${invoice.id}/legacy`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: { number: '125/2025', total: '122.00', pdfName: 'manual.pdf', job: null },
      editable: true,
      paymentSummary: { status: 'overdue', owed: '122.00' },
    })
    // Its Invoice links lead to its own page and to the original PDF
    const edit = await client.get(`/invoices/${invoice.id}/edit`).loginAs(office).redirects(0)
    edit.assertHeader('location', `/invoices/${invoice.id}/legacy`)
    const pdfLink = await client.get(`/invoices/${invoice.id}/pdf`).loginAs(office).redirects(0)
    pdfLink.assertHeader('location', `/invoices/${invoice.id}/legacy/pdf`)
    const original = await client.get(`/invoices/${invoice.id}/legacy/pdf`).loginAs(office)
    original.assertStatus(200)
    original.assertHeader('content-type', 'application/pdf')

    // In the Invoice list and on the Customer page
    const list = await client.get('/invoices').withInertia().loginAs(office)
    list.assertInertiaPropsContains({
      invoices: [{ id: invoice.id, number: '125/2025', documentType: 'legacy', total: '122.00' }],
    })
    const customerPage = await client.get(`/customers/${customer.id}`).withInertia().loginAs(office)
    customerPage.assertInertiaPropsContains({
      balance: '122.00',
      invoices: [
        { id: invoice.id, number: '125/2025', documentType: 'legacy', payment: 'overdue' },
      ],
    })
  })

  test('what a Legacy Invoice needs, and what is refused', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const other = await createCustomer({ name: 'Altro' })
    const job = await createJob(other)
    const standard = await vatCode()

    // Fields: the PDF (and only a PDF), amounts, dates in order and not ahead
    const noPdf = await post(client, office, legacyFields(customer), { file: null })
    assert.properties(noPdf.flashMessage('inputErrorsBag'), ['pdf'])
    const png = await post(client, office, legacyFields(customer), { file: notPdf })
    assert.deepEqual(png.flashMessage('inputErrorsBag').pdf, [
      it('validator.shared.messages.file.extname'),
    ])
    const bad = await post(
      client,
      office,
      legacyFields(customer, {
        number: ' ',
        issuedOn: DateTime.now().plus({ days: 1 }).toISODate()!,
        taxable: '-1',
        total: '0',
      })
    )
    assert.properties(bad.flashMessage('inputErrorsBag'), [
      'number',
      'issuedOn',
      'taxable',
      'total',
    ])
    const dueBefore = await post(client, office, legacyFields(customer, { dueOn: '2025-11-02' }))
    assert.properties(dueBefore.flashMessage('inputErrorsBag'), ['dueOn'])

    // Rules: a Job of the Customer; an advance on a Job, with VAT rows that
    // add up to what is printed
    const refusal = async (
      fields: Fields,
      reason: string,
      vatRows?: { vatCodeId: number; taxable: string }[]
    ) => {
      const response = await post(client, office, legacyFields(customer, fields), { vatRows })
      response.assertFlashMessage('error', it(`flash.legacyInvoiceRefused.${reason}`))
    }
    await refusal({ jobId: job.id }, 'customerNotOfJob')
    await refusal({ advance: true }, 'advanceWithoutJob')
    const own = await createJob(customer)
    await refusal({ jobId: own.id, advance: true }, 'noVatRows')
    await refusal({ jobId: own.id, advance: true }, 'rowsTaxable', [
      { vatCodeId: standard.id, taxable: '90' },
    ])
    await refusal({ jobId: own.id, advance: true, vat: '21,99', total: '121,99' }, 'rowsVat', [
      { vatCodeId: standard.id, taxable: '100' },
    ])
    await refusal({ jobId: own.id, advance: true, total: '124,00' }, 'advanceTotal', [
      { vatCodeId: standard.id, taxable: '100' },
    ])
    await refusal({ jobId: own.id, advance: true }, 'duplicateVatRow', [
      { vatCodeId: standard.id, taxable: '50' },
      { vatCodeId: standard.id, taxable: '50' },
    ])
    assert.lengthOf(await Invoice.query().where('documentType', 'legacy'), 0)
    // Nothing refused leaves a file behind
    assert.deepEqual(await storedPdfs(), [])

    // Not an advance: the totals stay as printed (e.g. a stamp duty)
    const stamped = await enter(client, legacyFields(customer, { total: '124,00' }))
    assert.equal(stamped.total, '124.00')
    // A number is used once a year
    await refusal({}, 'duplicateNumber')
    const nextYear = await enter(client, legacyFields(customer, { issuedOn: '2026-01-15' }))
    assert.equal(nextYear.formattedNumber, '125/2025')
  })

  test('"already paid" records one Payment for its total; it is paid like any Invoice', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()

    const paid = await enter(client, legacyFields(customer, { paid: true }))
    const payments = await Payment.query().where('invoiceId', paid.id)
    assert.deepEqual(
      payments.map((payment) => [payment.amount, payment.paidOn.toISODate()]),
      [['122.00', '2025-11-03']]
    )
    assert.isNotNull(payments[0].createdBy)
    const onDay = await enter(
      client,
      legacyFields(customer, { number: '126/2025', paid: true, paidOn: '2025-12-01' })
    )
    const [later] = await Payment.query().where('invoiceId', onDay.id)
    assert.equal(later.paidOn.toISODate(), '2025-12-01')

    // Paid before its date: recorded, with a warning (ADR 0014)
    const early = await post(
      client,
      office,
      legacyFields(customer, { number: '129/2025', paid: true, paidOn: '2025-10-30' })
    )
    early.assertFlashMessage(
      'warning',
      `${it('flash.legacyInvoiceCreated')} ${it('flash.paymentWarning.beforeIssued', {
        date: formatDate('2025-11-03'),
      })}`
    )
    const earlyInvoice = await created(early, '129/2025')
    const [earlyPayment] = await Payment.query().where('invoiceId', earlyInvoice.id)
    assert.equal(earlyPayment.paidOn.toISODate(), '2025-10-30')

    const page = await client.get(`/invoices/${paid.id}/legacy`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      paymentSummary: { status: 'paid', paid: '122.00', owed: '0.00' },
      // A Payment depends on it
      editable: false,
    })

    // Payments, refunds and statuses as on any Invoice (ADR 0014)
    const unpaid = await enter(
      client,
      legacyFields(customer, { number: '127/2025', issuedOn: daysAgo(3), dueOn: today() })
    )
    const pay = (amount: string) =>
      client
        .post(`/invoices/${unpaid.id}/payments`)
        .form({ amount, paidOn: today() })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
    const statusOf = async () => {
      const shown = await client.get(`/invoices/${unpaid.id}/legacy`).withInertia().loginAs(office)
      return shown.inertiaProps.paymentSummary.status
    }
    assert.equal(await statusOf(), 'unpaid')
    const part = await pay('22')
    part.assertFlashMessage('success', it('flash.paymentRecorded'))
    assert.equal(await statusOf(), 'partly_paid')
    const over = await pay('200')
    over.assertFlashMessage(
      'warning',
      [
        it('flash.paymentWarning.recorded'),
        it('flash.paymentWarning.overpaid', { amount: formatMoney('100') }),
      ].join(' ')
    )
    assert.equal(await statusOf(), 'overpaid')
    const overpaidList = await client
      .get('/invoices')
      .qs({ stage: 'overpaid' })
      .withInertia()
      .loginAs(office)
    assert.deepEqual(
      overpaidList.inertiaProps.invoices.map((row: { id: number }) => row.id),
      [unpaid.id]
    )
    await pay('-100')
    assert.equal(await statusOf(), 'paid')

    // Past its due date with something owed: overdue, and listed so
    const late = await enter(
      client,
      legacyFields(customer, { number: '128/2025', dueOn: '2025-12-31' })
    )
    const overdue = await client
      .get('/invoices')
      .qs({ stage: 'overdue' })
      .withInertia()
      .loginAs(office)
    assert.deepEqual(
      overdue.inertiaProps.invoices.map((row: { id: number }) => row.id),
      [late.id]
    )
  })

  test('every SDI action and line edits are refused', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const legacy = await enter(client, legacyFields(await createCustomer()))
    const standard = await vatCode()
    const send = (request: ReturnType<ApiClient['post']>) =>
      request.header('referer', '/').withCsrfToken().loginAs(office).redirects(0)

    const lines = await send(
      client.put(`/invoices/${legacy.id}`).json({
        lines: [{ description: 'Riga', quantity: '1', unitPrice: '10', vatCodeId: standard.id }],
      })
    )
    lines.assertFlashMessage('error', it('flash.invoiceNotEditable'))
    const finalise = await send(client.post(`/invoices/${legacy.id}/finalise`))
    finalise.assertFlashMessage('error', it('flash.invoiceNotEditable'))
    const deleted = await send(client.delete(`/invoices/${legacy.id}`))
    deleted.assertFlashMessage('error', it('flash.invoiceNotEditable'))
    for (const url of ['submissions', 'submissions/confirm']) {
      const response = await send(client.post(`/invoices/${legacy.id}/${url}`))
      response.assertFlashMessage('error', it('flash.submissionRefused'))
    }
    const outcome = await send(
      client.post(`/invoices/${legacy.id}/submissions/outcome`).form({ outcome: 'delivered' })
    )
    outcome.assertFlashMessage('error', it('flash.submissionRefused'))
    const xml = await client.get(`/invoices/${legacy.id}/xml`).loginAs(office)
    xml.assertStatus(404)

    // The services refuse it too, whatever the entry point
    await assert.rejects(() => Submissions.prepare(legacy), SubmissionRefusedError)
    await assert.rejects(() => Invoices.finalise(legacy))
    assert.throws(() => fatturaInputFor(legacy, '00001', 'Sconto'))

    // Nothing changed
    const after = await Invoice.query().where('id', legacy.id).preload('lines').firstOrFail()
    assert.equal(after.status, 'delivered')
    assert.lengthOf(after.lines, 0)
    assert.equal(after.total, '122.00')
    assert.lengthOf(await InvoiceSubmission.query().where('invoiceId', legacy.id), 0)
  })

  test('on a Job: invoiced so far, the indicators and what closing lists', async ({ client }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const job = await createJob(customer)

    const form = await client
      .get('/invoices/legacy/create')
      .qs({ jobId: job.id })
      .withInertia()
      .loginAs(office)
    form.assertInertiaPropsContains({ customer: { id: customer.id }, jobId: job.id })

    // A Job of an archived Customer: said on the Job page
    const archived = await createCustomer({ name: 'Archiviato', archivedAt: DateTime.now() })
    const archivedJob = await createJob(archived)
    const refused = await client
      .get('/invoices/legacy/create')
      .qs({ jobId: archivedJob.id })
      .loginAs(office)
      .redirects(0)
    refused.assertHeader('location', `/jobs/${archivedJob.id}`)
    refused.assertFlashMessage('error', it('flash.legacyInvoiceCustomerArchived'))

    const legacy = await enter(client, legacyFields(customer, { jobId: job.id }))
    let page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoices: [{ id: legacy.id, number: '125/2025', legacy: true, total: '122.00' }],
      invoicedSoFar: { amount: '100.00' },
      leftToClose: { unpaid: 1 },
      job: { indicators: { invoiced: true, paid: false } },
    })

    // Its Payments count toward the paid indicator (the Jobs list too)
    await Payments.record(legacy, { amount: '122', paidOn: DateTime.now() })
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      leftToClose: { unpaid: 0 },
      job: { indicators: { invoiced: true, paid: true } },
    })
    const list = await client.get('/jobs').qs({ status: 'invoiced' }).withInertia().loginAs(office)
    list.assertInertiaPropsContains({
      jobs: [{ id: job.id, indicators: { invoiced: true, paid: true } }],
    })
  })

  test('as an advance, a later Invoice of the Job takes it back', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const job = await jobWithCost(customer, '1500')
    const standard = await vatCode()
    const reduced = await vatCode('10%')

    // 500 at 22% and 200 at 10%: 700 + 110 + 20 = 830
    const advance = await enter(
      client,
      legacyFields(customer, {
        jobId: job.id,
        advance: true,
        taxable: '700',
        vat: '130',
        total: '830',
      }),
      [
        { vatCodeId: standard.id, taxable: '500' },
        { vatCodeId: reduced.id, taxable: '200' },
      ]
    )
    assert.isTrue(advance.advance)
    const rows = await db
      .from('legacy_vat_rows')
      .where('invoice_id', advance.id)
      .orderBy('position')
    assert.deepEqual(
      rows.map((row) => [row.vat_rate, row.taxable, row.vat]),
      [
        ['22.00', '500.00', '110.00'],
        ['10.00', '200.00', '20.00'],
      ]
    )

    // The final Invoice takes all of it back, row by row (ADR 0011)
    const final = await Invoices.fromJob(job)
    await final.load('lines', (lines) => lines.orderBy('position'))
    const label = `Detrazione acconto fattura 125/2025 del 03/11/2025`
    assert.deepEqual(
      final.lines.map((line) => [line.description, line.unitPrice, line.vatRate, line.vatCodeId]),
      [
        ['Lavori', '1500.0000', '22.00', standard.id],
        [label, '-500.0000', '22.00', standard.id],
        [label, '-200.0000', '10.00', reduced.id],
      ]
    )
    const deductions = await db.from('advance_deductions').where('invoice_id', final.id)
    assert.deepEqual(
      deductions.map((row) => [row.advance_id, row.amount]),
      [[advance.id, '830.00']]
    )

    // While a draft takes it back, it can't change
    const locked = await post(client, office, legacyFields(customer, { jobId: job.id }), {
      url: `/invoices/${advance.id}/legacy`,
      file: null,
    })
    locked.assertFlashMessage('error', it('flash.legacyInvoiceRefused.takenBack'))
    const kept = await client
      .delete(`/invoices/${advance.id}/legacy`)
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    kept.assertFlashMessage('error', it('flash.legacyInvoiceRefused.takenBack'))

    await Invoices.finalise(final)
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoices: [
        {
          id: advance.id,
          legacy: true,
          deduction: { deducted: '830.00', state: 'fully_deducted' },
        },
        { id: final.id },
      ],
      // 700 billed up front, then 1500 less the 700 taken back
      invoicedSoFar: { amount: '1500.00', of: '1500.00' },
      job: { indicators: { invoiced: true } },
    })
    const shown = await client.get(`/invoices/${advance.id}/legacy`).withInertia().loginAs(office)
    shown.assertInertiaPropsContains({
      editable: false,
      advanceState: { state: 'fully_deducted', deducted: '830.00', left: '0.00' },
    })
  })

  test('Office corrects or deletes one only while nothing depends on it', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const job = await createJob(customer)
    const legacy = await enter(client, legacyFields(customer))
    const firstPdf = legacy.pdfPath!
    const update = (fields: Fields, file: string | null = null) =>
      post(client, office, fields, { url: `/invoices/${legacy.id}/legacy`, file })

    // Corrected, PDF kept
    const saved = await update(
      legacyFields(customer, { jobId: job.id, number: '125-bis/2025', dueOn: '2025-12-31' })
    )
    saved.assertFlashMessage('success', it('flash.legacyInvoiceSaved'))
    await legacy.refresh()
    assert.deepEqual(
      [legacy.legacyNumber, legacy.jobId, legacy.dueOn!.toISODate(), legacy.pdfPath],
      ['125-bis/2025', job.id, '2025-12-31', firstPdf]
    )
    // A new PDF replaces the old one
    await update(legacyFields(customer, { number: '125-bis/2025' }), pdf)
    await legacy.refresh()
    assert.notEqual(legacy.pdfPath, firstPdf)
    assert.isNull(legacy.jobId)
    assert.isFalse(existsSync(storagePath(firstPdf)))
    assert.isTrue(existsSync(storagePath(legacy.pdfPath!)))

    // With a Payment: neither changed nor deleted
    const { payment } = await Payments.record(legacy, { amount: '10', paidOn: DateTime.now() })
    const refused = await update(legacyFields(customer, { number: 'X' }))
    refused.assertFlashMessage('error', it('flash.legacyInvoiceRefused.paid'))
    const destroy = () =>
      client
        .delete(`/invoices/${legacy.id}/legacy`)
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
    const kept = await destroy()
    kept.assertFlashMessage('error', it('flash.legacyInvoiceRefused.paid'))
    await legacy.refresh()
    assert.equal(legacy.legacyNumber, '125-bis/2025')

    // Once the Payment is removed, deleted with its PDF
    await Payments.remove(payment)
    const deleted = await destroy()
    deleted.assertHeader('location', '/invoices')
    deleted.assertFlashMessage('success', it('flash.legacyInvoiceDeleted'))
    assert.isNull(await Invoice.find(legacy.id))
    assert.isFalse(existsSync(storagePath(legacy.pdfPath!)))
  })

  test("the screen's actions: Save while it can change, the PDF to view, deleting asked first", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const screen = async (url: string) => {
      const page = await client.get(url).withInertia().loginAs(office)
      page.assertStatus(200)
      return page.inertiaProps.actions as ScreenAction[]
    }
    const ranked = (actions: ScreenAction[]) =>
      actions.map((action) => `${action.name}:${action.rank}`)

    // New: nothing until its Customer is picked, then Registra
    assert.deepEqual(await screen('/invoices/legacy/create'), [])
    const fresh = await screen(`/invoices/legacy/create?customerId=${customer.id}`)
    assert.deepEqual(ranked(fresh), ['save:primary'])
    assert.equal(fresh[0].label, it('ui.legacyInvoices.create'))
    assert.equal(fresh[0].form, 'legacy-invoice-form')

    // Saved, nothing depending on it: edited in place, deleted through its DELETE route
    const legacy = await enter(client, legacyFields(customer))
    const url = `/invoices/${legacy.id}/legacy`
    const editable = await screen(url)
    assert.deepEqual(ranked(editable), [
      'save:primary',
      'pdf:secondary',
      'creditNote:secondary',
      'delete:overflow',
    ])
    const pdfAction = editable.find((action) => action.name === 'pdf')!
    assert.deepEqual([pdfAction.href, pdfAction.file], [`${url}/pdf`, 'view'])
    const remove = editable.find((action) => action.name === 'delete')!
    assert.deepEqual(
      [remove.href, remove.method, remove.destructive, remove.confirm],
      [url, 'delete', true, it('ui.legacyInvoices.deleteConfirm')]
    )

    // Paid: neither Save nor deleting; the server refuses both anyway
    await Payments.record(legacy, { amount: '10', paidOn: DateTime.now() })
    assert.deepEqual(ranked(await screen(url)), ['pdf:secondary', 'creditNote:secondary'])
  })

  test('Technicians and the Superuser are refused on every route; Admins enter them', async ({
    client,
    assert,
  }) => {
    const customer = await createCustomer()
    const legacy = await enter(client, legacyFields(customer))
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const [method, url] of routes(legacy)) {
        let request = client[method](url)
        if (method === 'post' && url === '/invoices/legacy') {
          for (const [name, value] of Object.entries(legacyFields(customer, { number: 'Z' }))) {
            request = request.field(name, String(value))
          }
          request = request.file('pdf', pdf)
        }
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        if (method === 'get') response.assertStatus(403)
        else response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.lengthOf(await Invoice.query().where('documentType', 'legacy'), 1)
    await legacy.refresh()
    assert.equal(legacy.legacyNumber, '125/2025')

    const admin = await createUser('admin')
    const response = await post(client, admin, legacyFields(customer, { number: '1/2024' }))
    await created(response, '1/2024')
    const shown = await client.get(`/invoices/${legacy.id}/legacy`).withInertia().loginAs(admin)
    shown.assertStatus(200)
  })
})

/**
 * The PDFs kept in storage.
 */
async function storedPdfs() {
  const directory = storagePath('invoices/legacy')
  return existsSync(directory) ? readdir(directory) : []
}
