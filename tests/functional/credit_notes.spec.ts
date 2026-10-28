import { test } from '@japa/runner'
import type { Assert } from '@japa/assert'
import { DateTime } from 'luxon'
import type { ApiClient } from '@japa/api-client'
import i18nManager from '@adonisjs/i18n/services/main'
import db from '@adonisjs/lucid/services/db'
import type Customer from '#models/customer'
import type User from '#models/user'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import InvoiceSequence from '#models/invoice_sequence'
import Payment from '#models/payment'
import StockMovement from '#models/stock_movement'
import Invoices, { CreditNoteRefusedError, InvoiceNotFinalisableError } from '#services/invoices'
import Payments, { PaymentRefusedError } from '#services/payments'
import Submissions from '#services/submissions'
import CreditNoteNumbering from '#services/credit_note_numbering'
import DocumentRenderer from '#documents/document_renderer'
import { invoiceDocument } from '#documents/invoice_document'
import type { PdfConverter } from '#documents/pdf_converter'
import { OWED_SQL } from '#services/job_status'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { createItem, vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { fatturaSchemaErrors } from '#tests/helpers/fattura_xsd'
import { formatMoney } from '#shared/money'
import type { SubmissionOutcome } from '#shared/invoice_lifecycle'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const year = () => DateTime.now().year

/**
 * A finalised Invoice of 122.00 (two lines: 60 + 40 at 22%), optionally
 * for a Job.
 */
async function finalised(customer?: Customer, jobId?: number) {
  const invoice = await Invoices.create(customer ?? (await createCustomer()))
  if (jobId) await invoice.merge({ jobId }).save()
  const standard = await vatCode()
  await Invoices.save(invoice, {
    lines: [
      { description: 'Manodopera', quantity: '1', unitPrice: '60', vatCodeId: standard.id },
      { description: 'Materiale', quantity: '2', unitPrice: '20', vatCodeId: standard.id },
    ],
  })
  await Invoices.finalise(invoice)
  await invoice.refresh()
  return invoice
}

/**
 * Takes a finalised Invoice (or Credit Note) through a Submission to SDI's
 * `outcome`.
 */
async function sentTo(invoice: Invoice, outcome: SubmissionOutcome) {
  await Submissions.prepare(invoice)
  await Submissions.confirm(invoice, 'Sconto')
  await Submissions.recordOutcome(invoice, { outcome })
  await invoice.refresh()
  return invoice
}

/**
 * An Invoice of 122.00 SDI delivered (or reported not deliverable).
 */
async function issued(
  customer?: Customer,
  jobId?: number,
  outcome: SubmissionOutcome = 'delivered'
) {
  return sentTo(await finalised(customer, jobId), outcome)
}

/**
 * The Credit Note's lines as saved, in order.
 */
async function linesOf(invoice: Invoice) {
  return InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
}

/**
 * The amounts of the Invoice's lines as saved, in order.
 */
async function amountsOf(invoice: Invoice) {
  const lines = await linesOf(invoice)
  return lines.map((line) => line.lineTotal)
}

/**
 * The draft Credit Note for `invoice` (a new one, or the one still open)
 * with its lines crediting `prices` (unit prices before VAT, quantity 1,
 * one per credited line, in order).
 */
async function creditNote(invoice: Invoice, prices: string[]) {
  const note = await Invoices.createCreditNote(invoice)
  const lines = await linesOf(note)
  await Invoices.save(note, {
    lines: prices.map((unitPrice, index) => ({
      id: lines[index].id,
      ...(lines[index].itemId && { itemId: lines[index].itemId! }),
      description: lines[index].description,
      quantity: '1',
      unitPrice,
      vatCodeId: lines[index].vatCodeId,
    })),
  })
  await note.refresh()
  return note
}

/**
 * A second draft Credit Note for `invoice` while another is open (Office
 * gets the open one; two can exist, e.g. from before), crediting `price`
 * on the Invoice's first line.
 */
async function secondDraft(invoice: Invoice, price: string) {
  const note = await Invoice.create({
    customerId: invoice.customerId,
    status: 'draft',
    documentType: 'credit_note',
    creditsInvoiceId: invoice.id,
  })
  const [line] = await linesOf(invoice)
  await Invoices.save(note, {
    lines: [
      {
        description: line.description,
        quantity: '1',
        unitPrice: price,
        vatCodeId: line.vatCodeId,
        creditsLineId: line.id,
      },
    ],
  })
  return note
}

/**
 * Saves the Credit Note's lines as the page sends them, as `user`.
 */
async function saveLines(
  client: ApiClient,
  note: Invoice,
  user: User,
  lines: Record<string, unknown>[]
) {
  return client
    .put(`/invoices/${note.id}`)
    .json({ lines })
    .header('referer', `/invoices/${note.id}/edit`)
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

function finalise(client: ApiClient, invoice: Invoice, user: User) {
  return client
    .post(`/invoices/${invoice.id}/finalise`)
    .header('referer', `/invoices/${invoice.id}/edit`)
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

/**
 * Asserts `work` is refused with InvoiceNotFinalisableError for `reason`.
 */
async function assertRefused(assert: Assert, work: () => Promise<unknown>, reason: string) {
  try {
    await work()
  } catch (error) {
    assert.instanceOf(error, InvoiceNotFinalisableError)
    assert.equal((error as InvoiceNotFinalisableError).reason, reason)
    return
  }
  assert.fail(`expected a refusal (${reason})`)
}

const noConverter: PdfConverter = {
  convert: () => Promise.reject(new Error('renderHtml must not convert')),
}

test.group('Credit Notes', () => {
  test('Office credits a delivered Invoice: a draft linked to it, its lines credited in full', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    const original = await linesOf(invoice)

    const response = await client
      .post(`/invoices/${invoice.id}/credit-notes`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.creditNoteCreated'))
    const note = await Invoice.findByOrFail('creditsInvoiceId', invoice.id)
    response.assertHeader('location', `/invoices/${note.id}/edit`)
    assert.equal(note.documentType, 'credit_note')
    assert.equal(note.status, 'draft')
    assert.equal(note.customerId, invoice.customerId)
    assert.isNull(note.jobId)
    const lines = await linesOf(note)
    assert.deepEqual(
      lines.map((line) => [line.creditsLineId, line.description, line.lineTotal]),
      original.map((line) => [line.id, line.description, line.lineTotal])
    )

    // While it is a draft, crediting again opens it rather than another
    const again = await client
      .post(`/invoices/${invoice.id}/credit-notes`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertHeader('location', `/invoices/${note.id}/edit`)
    assert.lengthOf(await Invoice.query().where('creditsInvoiceId', invoice.id), 1)

    const page = await client.get(`/invoices/${note.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: {
        documentType: 'credit_note',
        credits: {
          id: invoice.id,
          number: invoice.formattedNumber,
          total: '122.00',
          left: '122.00',
        },
      },
      creditNotes: null,
      canCredit: false,
      paymentSummary: null,
    })
    const invoicePage = await client
      .get(`/invoices/${invoice.id}/edit`)
      .withInertia()
      .loginAs(office)
    invoicePage.assertInertiaPropsContains({
      canCredit: true,
      creditNotes: [{ id: note.id, number: null, status: 'draft', total: null }],
    })
  })

  test("a cancelled Job's Invoice can still be credited (ADR 0015)", async ({ assert }) => {
    await completeCompany()
    const customer = await createCustomer()
    const job = await createJob(customer)
    const invoice = await issued(customer, job.id)
    await job.merge({ status: 'cancelled', cancelledAt: DateTime.now() }).save()

    const note = await creditNote(invoice, ['10', '0'])
    await Invoices.finalise(note)
    await note.refresh()
    assert.equal(note.status, 'finalised')
  })

  test('a not deliverable Invoice can be credited too', async ({ assert }) => {
    await completeCompany()
    const invoice = await issued(undefined, undefined, 'not_deliverable')
    const note = await Invoices.createCreditNote(invoice)
    assert.equal(note.creditsInvoiceId, invoice.id)
  })

  test('drafts, Invoices not yet delivered, rejected ones, advances and Credit Notes are refused', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const draft = await Invoices.create(customer)
    const notSent = await finalised(customer)
    const submitted = await finalised(customer)
    await Submissions.prepare(submitted)
    await Submissions.confirm(submitted, 'Sconto')
    const rejected = await sentTo(await finalised(customer), 'rejected')
    const job = await createJob(customer)
    const advance = await Invoices.createAdvance(job)
    const [advanceLine] = await linesOf(advance)
    await Invoices.save(advance, {
      lines: [
        {
          id: advanceLine.id,
          description: advanceLine.description,
          quantity: '1',
          unitPrice: '100',
          vatCodeId: advanceLine.vatCodeId,
        },
      ],
    })
    await Invoices.finalise(advance)
    await sentTo(advance, 'delivered')
    const note = await creditNote(await issued(customer), ['10', '0'])
    await Invoices.finalise(note)
    await sentTo(note, 'delivered')

    const cases: [Invoice, string][] = [
      [draft, 'notIssued'],
      [notSent, 'notIssued'],
      [submitted, 'notIssued'],
      [rejected, 'notIssued'],
      [advance, 'advance'],
      [note, 'creditNote'],
    ]
    for (const [invoice, reason] of cases) {
      const response = await client
        .post(`/invoices/${invoice.id}/credit-notes`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('error', it(`flash.creditNoteRefused.${reason}`))
      response.assertHeader('location', `/invoices/${invoice.id}/edit`)
      await assert.rejects(() => Invoices.createCreditNote(invoice), CreditNoteRefusedError)
      const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
      page.assertInertiaPropsContains({ canCredit: false })
    }
    assert.lengthOf(await Invoice.query().where('documentType', 'credit_note'), 1)
  })

  test('the Credit Note follows the Invoice lifecycle, with TD04 XML naming the Invoice', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany({ taxCode: '01987654322' })
    const item = await createItem()
    const invoice = await issued()
    const note = await Invoices.createCreditNote(invoice)
    const lines = await linesOf(note)

    // Office lowers the first line and drops the second
    const saved = await saveLines(client, note, office, [
      {
        id: lines[0].id,
        description: 'Storno parziale manodopera',
        quantity: '1',
        unitPrice: '25',
        vatCodeId: lines[0].vatCodeId,
      },
    ])
    saved.assertFlashMessage('success', it('flash.invoiceSaved'))
    const kept = await linesOf(note)
    assert.deepEqual(
      kept.map((line) => [line.creditsLineId, line.lineTotal]),
      [[lines[0].creditsLineId, '25.00']]
    )

    const done = await finalise(client, note, office)
    await note.refresh()
    done.assertFlashMessage(
      'success',
      it('flash.creditNoteFinalised', { number: note.formattedNumber })
    )
    assert.equal(note.status, 'finalised')
    assert.equal(note.total, '30.50')
    assert.equal(note.series, 'invoice')
    // Shared numbering: the next number after the Invoice
    assert.equal(note.number, invoice.number! + 1)
    assert.isNull(note.dueOn)
    assert.isNull(note.paymentMethod)
    // Nothing goes back on stock (no Items here; see the stock test)
    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 0)

    await client.post(`/invoices/${note.id}/submissions`).withCsrfToken().loginAs(office)
    const xml = await client.get(`/invoices/${note.id}/xml`).loginAs(office)
    xml.assertStatus(200)
    assert.deepEqual(await fatturaSchemaErrors(xml.text()), [])
    assert.include(xml.text(), '<TipoDocumento>TD04</TipoDocumento>')
    assert.include(xml.text(), `<Numero>${note.formattedNumber}</Numero>`)
    assert.match(
      xml.text(),
      new RegExp(
        `<DatiFattureCollegate>\\s*<IdDocumento>${invoice.formattedNumber}</IdDocumento>\\s*<Data>${invoice.issuedOn!.toISODate()}</Data>\\s*</DatiFattureCollegate>`
      )
    )
    assert.notInclude(xml.text(), '<DatiPagamento>')

    await client.post(`/invoices/${note.id}/submissions/confirm`).withCsrfToken().loginAs(office)
    await client
      .post(`/invoices/${note.id}/submissions/outcome`)
      .form({ outcome: 'rejected', notes: '00404 Fattura duplicata' })
      .withCsrfToken()
      .loginAs(office)
    await note.refresh()
    assert.equal(note.status, 'rejected')

    // Corrected like an Invoice: same number, new total, then resubmitted
    const corrected = await saveLines(client, note, office, [
      {
        id: lines[0].id,
        description: 'Storno parziale manodopera',
        quantity: '1',
        unitPrice: '30',
        vatCodeId: lines[0].vatCodeId,
      },
    ])
    corrected.assertFlashMessage('success', it('flash.invoiceSaved'))
    const number = note.number
    await note.refresh()
    assert.equal(note.number, number)
    assert.equal(note.total, '36.60')
    await sentTo(note, 'delivered')
    assert.equal(note.status, 'delivered')

    const pdf = await client.get(`/invoices/${note.id}/pdf`).loginAs(office)
    pdf.assertStatus(200)
    assert.include(pdf.header('content-disposition'), `nota-di-credito-${number}-${year()}.pdf`)
  })

  test('the PDF says Nota di credito and names the Invoice it credits', async ({ assert }) => {
    await completeCompany()
    const invoice = await issued()
    const note = await creditNote(invoice, ['10', '0'])
    await Invoices.finalise(note)
    await note.refresh()
    await note.load('lines')

    const input = await invoiceDocument(note, i18nManager.locale('it'))
    const html = await new DocumentRenderer(noConverter).renderHtml(input)
    assert.equal(input.title, it('documents.creditNote.title', { number: note.formattedNumber }))
    assert.include(html, it('documents.creditNote.number'))
    assert.include(
      html,
      it('documents.creditNote.credits', {
        number: invoice.formattedNumber,
        date: invoice.issuedOn!.toFormat('dd/MM/yyyy'),
      })
    )
    assert.notInclude(html, it('documents.invoice.dueOn'))
  })

  test('each line credits a line of the Invoice', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    const other = await issued()
    const [elsewhere] = await linesOf(other)
    const note = await Invoices.createCreditNote(invoice)
    const lines = await linesOf(note)
    const standard = await vatCode()

    for (const line of [
      // A new line crediting nothing
      { description: 'Altro', quantity: '1', unitPrice: '5', vatCodeId: standard.id },
      // One crediting another Invoice's line
      {
        description: 'Altro',
        quantity: '1',
        unitPrice: '5',
        vatCodeId: standard.id,
        creditsLineId: elsewhere.id,
      },
    ]) {
      const response = await saveLines(client, note, office, [
        {
          id: lines[0].id,
          description: 'Manodopera',
          quantity: '1',
          unitPrice: '1',
          vatCodeId: standard.id,
        },
        line,
      ])
      response.assertFlashMessage('error', it('flash.invoiceNotFinalisable.uncreditedLine'))
    }
    // Unchanged
    assert.deepEqual(
      await amountsOf(note),
      lines.map((line) => line.lineTotal)
    )
  })

  test('Credit Notes never add up to more than the Invoice: on save and on finalise', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    const note = await Invoices.createCreditNote(invoice)
    const lines = await linesOf(note)
    const line = (index: number, unitPrice: string) => ({
      id: lines[index].id,
      description: lines[index].description,
      quantity: '1',
      unitPrice,
      vatCodeId: lines[index].vatCodeId,
    })

    // 100.01 + VAT is above the 122.00 total
    const above = await saveLines(client, note, office, [line(0, '60'), line(1, '40.01')])
    above.assertFlashMessage('error', it('flash.invoiceNotFinalisable.creditTooLarge'))
    assert.deepEqual(await amountsOf(note), ['60.00', '40.00'])
    // The whole Invoice can be credited
    const whole = await saveLines(client, note, office, [line(0, '60'), line(1, '40')])
    whole.assertFlashMessage('success', it('flash.invoiceSaved'))

    // Another draft for part of it is saved: drafts don't count
    const second = await secondDraft(invoice, '10')
    assert.lengthOf(await linesOf(second), 1)

    // Once the first is finalised, the second is refused on finalise
    const first = await finalise(client, note, office)
    await note.refresh()
    first.assertFlashMessage(
      'success',
      it('flash.creditNoteFinalised', { number: note.formattedNumber })
    )
    const refused = await finalise(client, second, office)
    refused.assertFlashMessage('error', it('flash.invoiceNotFinalisable.creditTooLarge'))
    await second.refresh()
    assert.equal(second.status, 'draft')
    assert.isNull(second.number)
  })

  test('several Credit Notes together up to the total; a rejected one still counts', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()

    // 50 + 30 + 20 before VAT: 122.00 in all
    const first = await creditNote(invoice, ['50', '0'])
    await Invoices.finalise(first)
    await sentTo(first, 'rejected')
    const second = await creditNote(invoice, ['30', '0'])
    await Invoices.finalise(second)
    // 24.41 is more than the 24.40 left: refused when saved
    await assertRefused(assert, () => creditNote(invoice, ['0', '20.01']), 'creditTooLarge')
    const third = await creditNote(invoice, ['0', '20'])
    await Invoices.finalise(third)

    const page = await client.get(`/invoices/${third.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ invoice: { credits: { left: '24.40' } } })

    // Correcting the rejected one upward is refused: nothing is left
    const [line] = await linesOf(first)
    const corrected = await saveLines(client, first, office, [
      {
        id: line.id,
        description: line.description,
        quantity: '1',
        unitPrice: '50.01',
        vatCodeId: line.vatCodeId,
      },
    ])
    corrected.assertFlashMessage('error', it('flash.invoiceNotFinalisable.creditTooLarge'))
    await first.refresh()
    assert.equal(first.total, '61.00')

    const invoicePage = await client
      .get(`/invoices/${invoice.id}/edit`)
      .withInertia()
      .loginAs(office)
    invoicePage.assertInertiaPropsContains({
      paymentSummary: { status: 'paid', credited: '122.00', paid: '0.00', owed: '0.00' },
    })
  })

  test('a Credit Note of nothing is refused, and its Items never move stock', async ({
    assert,
  }) => {
    await completeCompany()
    const item = await createItem()
    const standard = await vatCode()
    const invoice = await Invoices.create(await createCustomer())
    await Invoices.save(invoice, {
      lines: [
        {
          itemId: item.id,
          description: 'Rubinetto',
          quantity: '2',
          unitPrice: '50',
          vatCodeId: standard.id,
        },
      ],
    })
    await Invoices.finalise(invoice)
    await sentTo(invoice, 'delivered')
    const sold = await StockMovement.query().where('itemId', item.id)

    const empty = await creditNote(invoice, ['0'])
    await assertRefused(assert, () => Invoices.finalise(empty), 'empty')
    await creditNote(invoice, ['50'])
    await Invoices.finalise(empty)
    // Corrected after a Rejection, and with another quantity
    await sentTo(empty, 'rejected')
    const [line] = await linesOf(empty)
    assert.equal(line.itemId, item.id)
    await Invoices.save(empty, {
      lines: [
        {
          id: line.id,
          itemId: item.id,
          description: line.description,
          quantity: '2',
          unitPrice: '40',
          vatCodeId: line.vatCodeId,
        },
      ],
    })
    assert.lengthOf(await StockMovement.query().where('itemId', item.id), sold.length)
  })

  test('what is owed and the payment status follow Credit Notes, in TS and SQL', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    const owedSql = async () => {
      const row = await db
        .from('invoices')
        .where('id', invoice.id)
        .select(db.raw(`${OWED_SQL('invoices')} as owed`))
        .first()
      return Number(row.owed).toFixed(2)
    }
    const summary = async () => {
      const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
      return (page.inertiaProps as any).paymentSummary
    }

    // A draft Credit Note credits nothing yet
    const note = await creditNote(invoice, ['25', '0'])
    assert.equal(await owedSql(), '122.00')
    assert.include(await summary(), { owed: '122.00', credited: '0.00' })

    // Finalised, it comes off what is owed (30.50 credited)
    await Invoices.finalise(note)
    assert.equal(await owedSql(), '91.50')
    assert.include(await summary(), { owed: '91.50', credited: '30.50', status: 'unpaid' })

    // A Payment of the rest settles it, with no warning
    const paid = await client
      .post(`/invoices/${invoice.id}/payments`)
      .form({ amount: '91,50', paidOn: DateTime.now().toISODate()! })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    paid.assertFlashMessage('success', it('flash.paymentRecorded'))
    assert.equal(await owedSql(), '0.00')
    assert.include(await summary(), { owed: '0.00', status: 'paid', overpaidBy: null })

    // Another Credit Note on a paid Invoice overpays it: warned, to refund
    const more = await creditNote(invoice, ['0', '10'])
    const done = await finalise(client, more, office)
    await more.refresh()
    done.assertFlashMessage(
      'warning',
      `${it('flash.creditNoteFinalised', { number: more.formattedNumber })} ${it(
        'flash.creditNoteOverpaid',
        { number: invoice.formattedNumber, amount: formatMoney('12.20') }
      )}`
    )
    assert.equal(await owedSql(), '-12.20')
    assert.include(await summary(), { status: 'overpaid', overpaidBy: '12.20' })
    const overpaid = await client
      .get('/invoices')
      .qs({ stage: 'overpaid' })
      .withInertia()
      .loginAs(office)
    overpaid.assertInertiaPropsContains({ invoices: [{ id: invoice.id, payment: 'overpaid' }] })
    assert.lengthOf((overpaid.inertiaProps as any).invoices, 1)

    // The refund, a negative Payment on the Invoice, settles it again
    await Payments.record(invoice, { amount: '-12.20', paidOn: DateTime.now() })
    assert.equal(await owedSql(), '0.00')
    // Nothing is paid on a Credit Note
    await assert.rejects(
      () => Payments.record(more, { amount: '10', paidOn: DateTime.now() }),
      PaymentRefusedError
    )
    const refused = await client
      .post(`/invoices/${more.id}/payments`)
      .form({ amount: '10', paidOn: DateTime.now().toISODate()! })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.paymentRefused'))
    assert.lengthOf(await Payment.query().where('invoiceId', more.id), 0)
  })

  test('an overdue Invoice credited in full is no longer overdue, in TS and SQL', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await issued()
    // Due yesterday
    await invoice.merge({ dueOn: DateTime.now().minus({ days: 1 }) }).save()
    const overdue = async () => {
      const list = await client
        .get('/invoices')
        .qs({ stage: 'overdue' })
        .withInertia()
        .loginAs(office)
      return (list.inertiaProps as any).invoices.map((row: any) => [row.id, row.payment])
    }
    assert.deepEqual(await overdue(), [[invoice.id, 'overdue']])

    const note = await creditNote(invoice, ['60', '40'])
    await Invoices.finalise(note)
    assert.deepEqual(await overdue(), [])
    const all = await client.get('/invoices').withInertia().loginAs(office)
    all.assertInertiaPropsContains({
      invoices: [
        { id: note.id, documentType: 'credit_note', payment: null },
        { id: invoice.id, documentType: 'invoice', payment: 'paid' },
      ],
    })
  })

  test("a Job's Invoice credited and paid for the rest settles the Job, in TS and SQL", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const job = await createJob(customer)
    const invoice = await issued(customer, job.id)
    const ids = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number; status: string }[]).map((j) => [
        j.id,
        j.status,
      ])
    }
    await Payments.record(invoice, { amount: '100', paidOn: DateTime.now() })
    assert.deepEqual(await ids('invoiced'), [[job.id, 'invoiced']])

    // 18.03 + 3.97 VAT = 22.00 credited: nothing left owed
    const note = await creditNote(invoice, ['18.03', '0'])
    await Invoices.finalise(note)
    await note.refresh()
    assert.equal(note.total, '22.00')
    assert.deepEqual(await ids('closed'), [[job.id, 'closed']])
    assert.deepEqual(await ids('invoiced'), [])
    const page = await client.get(`/customers/${customer.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ balance: '0.00', overpaid: [] })
  })

  test('shared numbering: Credit Notes take the next Invoice number', async ({ assert }) => {
    await completeCompany()
    const invoice = await issued()
    const note = await creditNote(invoice, ['10', '0'])
    await Invoices.finalise(note)
    const next = await finalised()
    await note.refresh()
    assert.deepEqual(
      [invoice.formattedNumber, note.formattedNumber, next.formattedNumber],
      [`1/${year()}`, `2/${year()}`, `3/${year()}`]
    )
  })

  test('own numbering: Credit Notes have their own series; Invoices are not affected', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    await completeCompany()
    const invoice = await issued()

    const changed = await client
      .put('/settings/invoice-numbering/credit-notes')
      .form({ mode: 'own' })
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    // No Credit Note numbered this year: it applies at once, with the warning
    changed.assertFlashMessage(
      'warning',
      `${it('flash.creditNoteNumbering.own')} ${it('flash.creditNoteNumbering.now')} ${it(
        'flash.creditNoteNumbering.unbroken'
      )}`
    )

    const first = await creditNote(invoice, ['10', '0'])
    await Invoices.finalise(first)
    const second = await creditNote(invoice, ['10', '0'])
    await Invoices.finalise(second)
    const next = await finalised()
    await first.refresh()
    await second.refresh()
    assert.deepEqual(
      [first.formattedNumber, second.formattedNumber, next.formattedNumber],
      [`NC1/${year()}`, `NC2/${year()}`, `2/${year()}`]
    )
    assert.equal(first.series, 'credit_note')
    const sequence = await InvoiceSequence.query()
      .where('series', 'credit_note')
      .where('year', year())
      .firstOrFail()
    assert.equal(sequence.nextNumber, 3)

    // The Credit Note's XML carries its own number
    await Submissions.prepare(first)
    const xml = await client.get(`/invoices/${first.id}/xml`).loginAs(admin)
    assert.include(xml.text(), `<Numero>NC1/${year()}</Numero>`)
    assert.deepEqual(await fatturaSchemaErrors(xml.text()), [])
  })

  test('a numbering change applies at once until a Credit Note is numbered, then from 1 January', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    await completeCompany()
    const change = (mode: string) =>
      client
        .put('/settings/invoice-numbering/credit-notes')
        .form({ mode })
        .withCsrfToken()
        .loginAs(admin)
        .redirects(0)
    const state = async () => {
      const page = await client.get('/settings/invoice-numbering').withInertia().loginAs(admin)
      return (page.inertiaProps as any).creditNotes
    }
    assert.deepEqual(await state(), {
      year: year(),
      current: 'shared',
      next: 'shared',
      changesNow: true,
    })

    // Back and forth while none is numbered: each change applies at once
    await change('own')
    await change('shared')
    assert.deepEqual(await state(), {
      year: year(),
      current: 'shared',
      next: 'shared',
      changesNow: true,
    })

    // A Credit Note numbered this year in the Invoice sequence
    const note = await creditNote(await issued(), ['10', '0'])
    await Invoices.finalise(note)
    const later = await change('own')
    later.assertFlashMessage(
      'warning',
      `${it('flash.creditNoteNumbering.own')} ${it('flash.creditNoteNumbering.nextYear', {
        year: year() + 1,
      })} ${it('flash.creditNoteNumbering.unbroken')}`
    )
    assert.deepEqual(await state(), {
      year: year(),
      current: 'shared',
      next: 'own',
      changesNow: false,
    })
    assert.equal(await CreditNoteNumbering.modeFor(undefined, year() + 1), 'own')
    assert.equal(await CreditNoteNumbering.modeFor(undefined, year() + 5), 'own')

    // This year's Credit Notes keep the Invoice sequence
    const another = await creditNote(await issued(), ['10', '0'])
    await Invoices.finalise(another)
    await another.refresh()
    assert.equal(another.series, 'invoice')

    // Choosing this year's mode again cancels the change waiting for January
    await change('shared')
    assert.deepEqual(await state(), {
      year: year(),
      current: 'shared',
      next: 'shared',
      changesNow: false,
    })
  })

  test('Technicians and the Superuser can not credit, edit, finalise or delete Credit Notes', async ({
    client,
    assert,
  }) => {
    await completeCompany()
    const invoice = await issued()
    const note = await Invoices.createCreditNote(invoice)
    const [line] = await linesOf(note)
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      const page = await client.get(`/invoices/${note.id}/edit`).withInertia().loginAs(user)
      page.assertStatus(403)
      for (const request of [
        client.post(`/invoices/${invoice.id}/credit-notes`),
        client.put(`/invoices/${note.id}`).json({
          lines: [
            {
              id: line.id,
              description: 'X',
              quantity: '1',
              unitPrice: '1',
              vatCodeId: line.vatCodeId,
            },
          ],
        }),
        client.post(`/invoices/${note.id}/finalise`),
        client.delete(`/invoices/${note.id}`),
      ]) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    await note.refresh()
    assert.equal(note.status, 'draft')
    assert.lengthOf(await Invoice.query().where('creditsInvoiceId', invoice.id), 1)
    assert.deepEqual(await amountsOf(note), ['60.00', '40.00'])
  })

  test('Admins credit Invoices too, and delete a draft Credit Note', async ({ client, assert }) => {
    const admin = await createUser('admin')
    await completeCompany()
    const invoice = await issued()
    const created = await client
      .post(`/invoices/${invoice.id}/credit-notes`)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    created.assertFlashMessage('success', it('flash.creditNoteCreated'))
    const note = await Invoice.findByOrFail('creditsInvoiceId', invoice.id)
    await client.delete(`/invoices/${note.id}`).withCsrfToken().loginAs(admin)
    assert.isNull(await Invoice.find(note.id))
    // The Invoice's lines stay as they were
    assert.lengthOf(await linesOf(invoice), 2)
  })

  test('only the Admin changes Credit Note numbering', async ({ client, assert }) => {
    for (const role of ['office', 'technician', 'superuser'] as const) {
      const user = await createUser(role)
      const page = await client.get('/settings/invoice-numbering').withInertia().loginAs(user)
      page.assertStatus(403)
      const response = await client
        .put('/settings/invoice-numbering/credit-notes')
        .form({ mode: 'own' })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.equal(await CreditNoteNumbering.modeFor(undefined, year()), 'shared')

    const admin = await createUser('admin')
    const invalid = await client
      .put('/settings/invoice-numbering/credit-notes')
      .form({ mode: 'mixed' })
      .header('referer', '/settings/invoice-numbering')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    assert.property(invalid.flashMessage('inputErrorsBag') ?? {}, 'mode')
    assert.equal(await CreditNoteNumbering.modeFor(undefined, year()), 'shared')
  })
})

test.group('Credit Notes concurrently', () => {
  test('two Credit Notes finalised together can not pass the total', async ({
    assert,
    cleanup,
  }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)
    await completeCompany()
    const invoice = await issued()
    // Each credits 60 + VAT of the 122.00: either fits alone, not both
    const first = await creditNote(invoice, ['60', '0'])
    const second = await secondDraft(invoice, '60')

    // Separate pooled connections: real row locks, unlike the global transaction
    const results = await Promise.allSettled([Invoices.finalise(first), Invoices.finalise(second)])
    assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
    const issuedNotes = await Invoice.query()
      .where('creditsInvoiceId', invoice.id)
      .whereNot('status', 'draft')
    assert.lengthOf(issuedNotes, 1)
  }).tags(['@committed'])
})
