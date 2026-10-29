import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type Customer from '#models/customer'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import LegacyVatRow from '#models/legacy_vat_row'
import Charges from '#services/charges'
import Invoices, { InvoiceNotFinalisableError } from '#services/invoices'
import Payments from '#services/payments'
import Submissions from '#services/submissions'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { fatturaSchemaErrors } from '#tests/helpers/fattura_xsd'
import { owed } from '#shared/payment_status'
import { deductionRows } from '#shared/advances'
import Big from 'big.js'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * A Legacy Invoice as entered (its PDF path aside): 100 + 22 = 122 unless
 * told otherwise; an advance with VAT rows when `rows` are given.
 */
async function legacy(
  customer: Customer,
  values: Partial<Invoice> = {},
  rows: { name: string; taxable: string; vat: string }[] = []
) {
  const invoice = await Invoice.create({
    customerId: customer.id,
    documentType: 'legacy',
    status: 'delivered',
    legacyNumber: 'FT 125/2025',
    issuedOn: DateTime.fromISO('2025-11-03'),
    dueOn: DateTime.fromISO('2025-12-03'),
    taxable: '100.00',
    vat: '22.00',
    total: '122.00',
    pdfPath: 'invoices/legacy/x.pdf',
    pdfName: 'x.pdf',
    advance: rows.length > 0,
    ...values,
  })
  for (const [position, row] of rows.entries()) {
    const code = await vatCode(row.name)
    await LegacyVatRow.create({
      invoiceId: invoice.id,
      position,
      vatCodeId: code.id,
      vatRate: code.rate,
      natura: code.natura,
      legalNote: code.legalNote,
      taxable: row.taxable,
      vat: row.vat,
    })
  }
  return invoice
}

async function linesOf(invoice: Invoice) {
  return InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
}

/**
 * Saves the Credit Note with free lines: [VAT Code name, taxable].
 */
async function saveLines(note: Invoice, lines: [string, string][]) {
  const values = []
  for (const [name, unitPrice] of lines) {
    const code = await vatCode(name)
    values.push({ description: 'Storno', quantity: '1', unitPrice, vatCodeId: code.id })
  }
  await Invoices.save(note, { lines: values })
  await note.refresh()
  return note
}

async function owedOn(invoice: Invoice) {
  const fresh = await Invoice.query()
    .where('id', invoice.id)
    .preload('payments')
    .preload('creditNotes')
    .firstOrFail()
  return owed({ total: fresh.total!, credited: fresh.credited, paid: fresh.paid })
}

async function refusal(work: () => Promise<unknown>) {
  try {
    await work()
  } catch (error) {
    if (error instanceof InvoiceNotFinalisableError) return error.reason
    throw error
  }
  return null
}

test.group('Credit Notes on Legacy Invoices', () => {
  test('Office credits one in full: amounts, TD04 naming the old number, owed nothing', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await legacy(await createCustomer())

    const page = await client.get(`/invoices/${invoice.id}/legacy`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canCredit: true, creditNotes: [] })
    const response = await client
      .post(`/invoices/${invoice.id}/credit-notes`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    const note = await Invoice.findByOrFail('creditsInvoiceId', invoice.id)
    response.assertHeader('location', `/invoices/${note.id}/edit`)

    // One free line for its taxable, at the VAT Code its VAT shows
    const standard = await vatCode('22%')
    const lines = await linesOf(note)
    assert.deepEqual(
      lines.map((line) => [line.description, line.unitPrice, line.vatCodeId, line.creditsLineId]),
      [['Storno fattura FT 125/2025 del 03/11/2025', '100.0000', standard.id, null]]
    )
    const edit = await client.get(`/invoices/${note.id}/edit`).withInertia().loginAs(office)
    edit.assertInertiaPropsContains({
      invoice: { credits: { id: invoice.id, legacy: true, number: 'FT 125/2025', left: '122.00' } },
    })

    await Invoices.finalise(note)
    await note.refresh()
    assert.equal(note.total, '122.00')
    assert.equal(await owedOn(invoice), '0.00')

    // DatiFattureCollegate names the old number and date; the file is valid
    const submission = await Submissions.prepare(note)
    const xml = await Submissions.xml(note, submission, 'Sconto')
    assert.include(xml, '<TipoDocumento>TD04</TipoDocumento>')
    assert.match(
      xml,
      /<DatiFattureCollegate>\s*<IdDocumento>FT 125\/2025<\/IdDocumento>\s*<Data>2025-11-03<\/Data>\s*<\/DatiFattureCollegate>/
    )
    assert.deepEqual(await fatturaSchemaErrors(xml), [])

    // Once credited, it no longer changes
    const locked = await client
      .delete(`/invoices/${invoice.id}/legacy`)
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    locked.assertFlashMessage('error', it('flash.legacyInvoiceRefused.credited'))
  })

  test('a partial credit, then the cap: never more than its total nor its taxable', async ({
    assert,
  }) => {
    await completeCompany()
    const customer = await createCustomer()
    const invoice = await legacy(customer)
    await Payments.record(invoice, { amount: '50', paidOn: DateTime.now() })

    const first = await saveLines(await Invoices.createCreditNote(invoice), [['22%', '50']])
    await Invoices.finalise(first)
    await first.refresh()
    assert.equal(first.total, '61.00')
    assert.equal(await owedOn(invoice), '11.00')

    // 61 + 73.20 is more than its 122
    const second = await Invoices.createCreditNote(invoice)
    const prefilled = await linesOf(second)
    assert.deepEqual(
      prefilled.map((line) => line.unitPrice),
      ['50.0000']
    )
    assert.equal(await refusal(() => saveLines(second, [['22%', '60']])), 'creditTooLarge')
    assert.equal(
      await refusal(() =>
        saveLines(second, [
          ['22%', '30'],
          ['22%', '-5'],
        ])
      ),
      'negativeCredit'
    )
    await saveLines(second, [['22%', '50']])
    await Invoices.finalise(second)
    assert.equal(await owedOn(invoice), '-50.00')

    // Its total holds a stamp duty: the taxable caps what is credited
    const stamped = await legacy(customer, { legacyNumber: '126/2025', total: '124.00' })
    const note = await Invoices.createCreditNote(stamped)
    assert.equal(
      await refusal(() => saveLines(note, [['Non soggetta', '101']])),
      'lineCreditTooLarge'
    )
    await saveLines(note, [['22%', '100']])
    await Invoices.finalise(note)
    assert.equal(await owedOn(stamped), '2.00')
  })

  test('a Legacy advance credited by VAT row: less is left to take back', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const job = await createJob(customer, { status: 'in_progress', workCategory: 'sale' })
    await Charges.add(
      job,
      { description: 'Lavori', quantity: '1', unit: null, unitPrice: '1500', vatKind: 'labour' },
      office
    )
    // 500 at 22% and 200 at 10%: 700 + 110 + 20 = 830
    const advance = await legacy(
      customer,
      { jobId: job.id, taxable: '700.00', vat: '130.00', total: '830.00' },
      [
        { name: '22%', taxable: '500.00', vat: '110.00' },
        { name: '10%', taxable: '200.00', vat: '20.00' },
      ]
    )

    const note = await Invoices.createCreditNote(advance)
    const rows = await linesOf(note)
    assert.deepEqual(
      rows.map((line) => [line.unitPrice, line.vatRate]),
      [
        ['500.0000', '22.00'],
        ['200.0000', '10.00'],
      ]
    )
    // Only at its VAT rows, and never more than a row
    assert.equal(await refusal(() => saveLines(note, [['4%', '10']])), 'legacyVatRow')
    assert.equal(await refusal(() => saveLines(note, [['22%', '501']])), 'lineCreditTooLarge')
    await saveLines(note, [['22%', '100']])
    await Invoices.finalise(note)

    const [entry] = await Invoices.advancesOf(undefined, job.id)
    assert.deepEqual([entry.credited, entry.left], ['122.00', '708.00'])
    let page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoices: [{ id: advance.id, deduction: { credited: '122.00', state: 'partly_deducted' } }],
    })

    // The final Invoice takes back what is left, row by row
    const final = await Invoices.fromJob(job)
    const lines = await linesOf(final)
    assert.deepEqual(
      lines.map((line) => [line.unitPrice, line.vatRate]),
      [
        ['1500.0000', '22.00'],
        ['-400.0000', '22.00'],
        ['-200.0000', '10.00'],
      ]
    )
    const deductions = await db.from('advance_deductions').where('invoice_id', final.id)
    assert.deepEqual(
      deductions.map((row) => row.amount),
      ['708.00']
    )
    await Invoices.finalise(final)
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoices: [{ id: advance.id, deduction: { state: 'fully_deducted' } }, { id: final.id }],
    })
    // Nothing left to credit now
    const shown = await client.get(`/invoices/${advance.id}/legacy`).withInertia().loginAs(office)
    shown.assertInertiaPropsContains({ canCredit: false })
  })

  test('Technicians and the Superuser can not credit one; Admins can', async ({
    client,
    assert,
  }) => {
    const invoice = await legacy(await createCustomer())
    for (const role of ['technician', 'superuser'] as const) {
      const response = await client
        .post(`/invoices/${invoice.id}/credit-notes`)
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(await createUser(role))
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await Invoice.query().where('creditsInvoiceId', invoice.id), 0)

    const response = await client
      .post(`/invoices/${invoice.id}/credit-notes`)
      .withCsrfToken()
      .loginAs(await createUser('admin'))
      .redirects(0)
    response.assertStatus(302)
    assert.lengthOf(await Invoice.query().where('creditsInvoiceId', invoice.id), 1)
  })

  test('a later Invoice takes back part of a Legacy advance, split over its VAT rows', async ({
    assert,
  }) => {
    await completeCompany()
    const { job, advance } = await jobWithLegacyAdvance()

    const final = await Invoices.fromJob(job)
    const drafted = await linesOf(final)
    const work = drafted.filter((line) => !line.deductsInvoiceId)
    await Invoices.save(final, {
      lines: work.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCodeId: line.vatCodeId,
      })),
      deductions: [{ advanceId: advance.id, amount: '415' }],
    })
    // Half of 830, in proportion to each row's 610 and 220: half of each (ADR 0011)
    const expected = deductionRows(
      [
        { vatRate: '22.00', natura: null, taxable: '500.00', vat: '110.00' },
        { vatRate: '10.00', natura: null, taxable: '200.00', vat: '20.00' },
      ],
      '415',
      '830.00'
    )
    const saved = await linesOf(final)
    const lines = saved.filter((line) => line.deductsInvoiceId === advance.id)
    assert.deepEqual(
      lines.map((line) => [line.vatRate, new Big(line.unitPrice).neg().toFixed(2)]),
      expected.map((row) => [row.vatRate, row.taxable])
    )
    assert.deepEqual(
      expected.map((row) => row.taxable),
      ['250.00', '100.00']
    )
    await Invoices.finalise(final)
    const [entry] = await Invoices.advancesOf(undefined, job.id)
    assert.deepEqual([entry.deducted, entry.left], ['415.00', '415.00'])
  })

  test('a Credit Note on the final Invoice gives a Legacy advance back', async ({ assert }) => {
    await completeCompany()
    const { job, advance } = await jobWithLegacyAdvance()
    const final = await Invoices.fromJob(job)
    await Invoices.finalise(final)
    await Submissions.prepare(final)
    await Submissions.confirm(final, 'Sconto')
    await Submissions.recordOutcome(final, { outcome: 'delivered' })
    let [entry] = await Invoices.advancesOf(undefined, job.id)
    assert.equal(entry.left, '0.00')

    // The Credit Note copies the deduction lines, giving the advance back
    const note = await Invoices.createCreditNote(final)
    const copied = await linesOf(note)
    const given = copied.filter((line) => line.deductsInvoiceId === advance.id)
    assert.deepEqual(
      given.map((line) => [line.unitPrice, line.vatRate]),
      [
        ['-500.0000', '22.00'],
        ['-200.0000', '10.00'],
      ]
    )
    await Invoices.finalise(note)
    ;[entry] = await Invoices.advancesOf(undefined, job.id)
    assert.deepEqual([entry.deducted, entry.left], ['0.00', '830.00'])
  })
})

/**
 * A Job (a sale, 22% on labour) with 1,500 to bill and a Legacy advance of
 * 830: 500 at 22% and 200 at 10%.
 */
async function jobWithLegacyAdvance() {
  const office = await createUser('office')
  const customer = await createCustomer()
  const job = await createJob(customer, { status: 'in_progress', workCategory: 'sale' })
  await Charges.add(
    job,
    { description: 'Lavori', quantity: '1', unit: null, unitPrice: '1500', vatKind: 'labour' },
    office
  )
  const advance = await legacy(
    customer,
    { jobId: job.id, taxable: '700.00', vat: '130.00', total: '830.00' },
    [
      { name: '22%', taxable: '500.00', vat: '110.00' },
      { name: '10%', taxable: '200.00', vat: '20.00' },
    ]
  )
  return { job, advance }
}
