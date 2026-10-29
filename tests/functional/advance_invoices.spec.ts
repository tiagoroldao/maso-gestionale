import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import Invoices, { type InvoiceNotFinalisableError } from '#services/invoices'
import Quotes from '#services/quotes'
import Submissions from '#services/submissions'
import Charges from '#services/charges'
import db from '@adonisjs/lucid/services/db'
import { buildFatturaPA, fatturaInputFor } from '#fiscal/fattura_pa'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import { confirmUsed } from '#tests/helpers/charges'
import type Job from '#models/job'

/**
 * A Job with an accepted Quote of 1,000.00 at 22%, its line imported
 * onto the Job as a Charge (ADR 0012).
 */
async function acceptedJob() {
  const job = await createJob(await createCustomer(), { workCategory: 'sale' })
  const standard = await vatCode()
  const rate = await LabourRate.create({ name: 'Lavori', hourlyPrice: '1000' })
  const quote = await Quotes.create(job, {
    lines: [
      {
        kind: 'labour',
        labourRateId: rate.id,
        description: 'Lavori',
        quantity: '1',
        unitPrice: '1000',
        vatCodeId: standard.id,
      },
    ],
  })
  await Quotes.accept(quote)
  await job.refresh()
  await quote.load('lines')
  await Quotes.importLines(
    quote,
    { lineIds: quote.lines.map((line) => line.id), workerName: 'Ditta Rossi' },
    await createUser('office')
  )
  // Planned until Office confirms the work done (ADR 0016)
  await confirmUsed(job.id)
  return job
}

/**
 * An Advance Invoice for the Job, priced and finalised.
 */
async function issuedAdvance(job: Job, amount: string) {
  const advance = await Invoices.createAdvance(job)
  await advance.load('lines')
  const [line] = advance.lines
  await Invoices.save(advance, {
    lines: [
      {
        description: line.description,
        quantity: '1',
        unitPrice: amount,
        vatCodeId: line.vatCodeId,
      },
    ],
  })
  await Invoices.finalise(advance)
  await advance.refresh()
  return advance
}

async function pricesOf(invoice: Invoice) {
  const lines = await linesOf(invoice)
  return lines.map(([, price]) => price)
}

/**
 * A Job without a Quote (a sale: 22% on labour) and a way to add costs
 * to it, each billable at once.
 */
async function costJob() {
  await completeCompany()
  const office = await createUser('office')
  const job = await createJob(await createCustomer(), {
    status: 'in_progress',
    workCategory: 'sale',
  })
  const cost = (price: string) =>
    Charges.add(
      job,
      { description: 'Costo', quantity: '1', unit: null, unitPrice: price, vatKind: 'labour' },
      office
    )
  return { office, job, cost }
}

/**
 * The Invoice's own lines (not its deductions), as the page sends them
 * back (needs `lines` loaded).
 */
function workLines(invoice: Invoice) {
  return invoice.lines
    .filter((line) => !line.deductsInvoiceId)
    .map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatCodeId: line.vatCodeId,
    }))
}

const labelOf = (advance: Invoice) =>
  `Detrazione acconto fattura ${advance.formattedNumber} del ${advance.issuedOn!.toFormat('dd/MM/yyyy')}`

/**
 * What the Invoice takes back of each advance: [advance id, amount].
 */
async function deductionsOf(invoice: Invoice) {
  const rows = await db.from('advance_deductions').where('invoice_id', invoice.id).orderBy('id')
  return rows.map((row) => [row.advance_id, row.amount])
}

async function linesOf(invoice: Invoice) {
  await invoice.load('lines', (lines) => lines.orderBy('position'))
  return invoice.lines.map((line) => [line.description, line.unitPrice, line.vatRate])
}

test.group('Advance Invoices', () => {
  test('Office issues an Advance Invoice from the Job; it is TD02', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const job = await acceptedJob()

    const response = await client
      .post(`/jobs/${job.id}/advance-invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    const advance = await Invoice.findByOrFail('jobId', job.id)
    response.assertHeader('location', `/invoices/${advance.id}/edit`)
    assert.isTrue(advance.advance)
    assert.equal(advance.status, 'draft')
    // Job sale for a company: the default rules give 22%
    assert.deepEqual(await linesOf(advance), [
      [`Acconto – ${job.number} ${job.title}`, '0.0000', '22.00'],
    ])

    const issued = await issuedAdvance(job, '300')
    await issued.load('lines')
    const xml = buildFatturaPA(fatturaInputFor(issued, '0000A', 'Sconto'))
    assert.include(xml, '<TipoDocumento>TD02</TipoDocumento>')
  })

  test("the final Invoice takes each advance back; the Job counts what's invoiced", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const job = await acceptedJob()
    const advance = await issuedAdvance(job, '300')

    // Advances alone don't make the Job Invoiced
    let page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      canInvoice: true,
      invoicedSoFar: { amount: '300.00', of: '1000.00' },
      job: { status: 'open' },
    })

    const final = await Invoices.fromJob(job)
    const label = `Detrazione acconto fattura ${advance.formattedNumber} del ${advance.issuedOn!.toFormat('dd/MM/yyyy')}`
    assert.deepEqual(await linesOf(final), [
      ['Lavori', '1000.0000', '22.00'],
      [label, '-300.0000', '22.00'],
    ])
    // It bills everything: it takes back all of the advance, VAT included
    assert.deepEqual(await deductionsOf(final), [[advance.id, '366.00']])
    assert.equal(final.totals.taxable, '700.00')

    // Office can edit the draft with its deduction line
    const saved = await client
      .put(`/invoices/${final.id}`)
      .json({
        lines: final.lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatCodeId: line.vatCodeId,
          // As the page sends it back
          ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
        })),
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    saved.assertFlashMessage('success', it('flash.invoiceSaved'))

    await Invoices.finalise(final)
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoicedSoFar: { amount: '1000.00', of: '1000.00' },
      job: { indicators: { invoiced: true } },
      invoices: [
        { id: advance.id, deduction: { deducted: '366.00', state: 'fully_deducted' } },
        { id: final.id, deduction: null },
      ],
    })
  })

  test('deduction lines saved back with their ids still take the advance back', async ({
    assert,
  }) => {
    await completeCompany()
    const job = await acceptedJob()
    await issuedAdvance(job, '300')
    const final = await Invoices.fromJob(job)
    await final.load('lines', (lines) => lines.orderBy('position'))
    const ids = final.lines.map((line) => line.id)

    await Invoices.save(final, {
      lines: final.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCodeId: line.vatCodeId,
        ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
      })),
    })
    await Invoices.finalise(final)
    await final.refresh()
    await final.load('lines', (lines) => lines.orderBy('position'))
    assert.equal(final.status, 'finalised')
    assert.deepEqual(
      final.lines.map((line) => line.id),
      ids
    )
    assert.equal(final.totals.taxable, '700.00')
  })

  test('deleting the final draft frees the advance for the next one', async ({ assert }) => {
    await completeCompany()
    const job = await acceptedJob()
    const advance = await issuedAdvance(job, '300')
    const first = await Invoices.fromJob(job)

    await Invoices.destroy(first)
    assert.lengthOf(await db.from('advance_deductions').where('advance_id', advance.id), 0)
    const second = await Invoices.fromJob(job)
    assert.lengthOf(await linesOf(second), 2)
    assert.deepEqual(await deductionsOf(second), [[advance.id, '366.00']])
  })

  test('without a Quote: the first draft deducts the advance, later ones do not', async ({
    assert,
  }) => {
    await completeCompany()
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), {
      status: 'in_progress',
      workCategory: 'sale',
    })
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const visitWith = async (hours: string) => {
      const start = DateTime.now().minus({ days: 1 })
      const visit = await Visit.create({
        jobId: job.id,
        startsAt: start,
        endsAt: start.plus({ hours: 2 }),
        status: 'planned',
      })
      await visit.related('technicians').attach([anna.id])
      await FieldWork.recordHours(visit, { technicianId: anna.id, labourRateId: rate.id, hours })
      await FieldWork.setStatus(visit, 'done', anna)
    }
    await issuedAdvance(job, '50')
    await visitWith('5')

    const first = await Invoices.fromJob(job)
    assert.deepEqual(await pricesOf(first), ['40.0000', '-50.0000'])
    await Invoices.finalise(first)

    await visitWith('1')
    const second = await Invoices.fromJob(job)
    assert.deepEqual(await pricesOf(second), ['40.0000'])
  })

  test("the final Invoice's discount is on the work, never on the advance", async ({ assert }) => {
    await completeCompany()
    const job = await acceptedJob()
    await issuedAdvance(job, '300')
    const final = await Invoices.fromJob(job)
    await final.load('lines')

    await Invoices.save(final, {
      discountPercent: '10',
      lines: final.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCodeId: line.vatCodeId,
        ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
      })),
    })
    await final.refresh()
    await final.load('lines')
    // 1000 less 10% = 900, less the 300 already billed
    assert.equal(final.totals.taxable, '600.00')
  })

  test('Office takes back part of an advance, never more than is left nor below zero', async ({
    client,
    assert,
  }) => {
    const { office, job, cost } = await costJob()
    const advance = await issuedAdvance(job, '500')
    await cost('35')

    // The draft bills everything, so it starts with all of the advance:
    // 35 + 22% less 610 would be negative
    const first = await Invoices.fromJob(job)
    assert.deepEqual(await deductionsOf(first), [[advance.id, '610.00']])
    const save = (deductions: { advanceId: number; amount: string }[]) =>
      client
        .put(`/invoices/${first.id}`)
        .json({ lines: workLines(first), deductions })
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
    const refused = await client
      .post(`/invoices/${first.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.invoiceNotFinalisable.negativeTotal'))

    // More than the advance, or a total below zero, isn't saved
    await first.load('lines')
    const tooMuch = await save([{ advanceId: advance.id, amount: '610,01' }])
    tooMuch.assertFlashMessage('error', it('flash.invoiceNotFinalisable.deductionTooLarge'))
    const negative = await save([{ advanceId: advance.id, amount: '50' }])
    negative.assertFlashMessage('error', it('flash.invoiceNotFinalisable.negativeTotal'))
    assert.deepEqual(await deductionsOf(first), [[advance.id, '610.00']])

    // As much as this Invoice bills: it comes to zero
    const saved = await save([{ advanceId: advance.id, amount: '42,70' }])
    saved.assertFlashMessage('success', it('flash.invoiceSaved'))
    assert.deepEqual(await pricesOf(first), ['35.0000', '-35.0000'])
    await Invoices.finalise(first)

    // Partly deducted: the Job isn't Invoiced until the rest is taken back
    let page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoices: [{ id: advance.id, deduction: { deducted: '42.70', state: 'partly_deducted' } }],
    })
    assert.isFalse(page.inertiaProps.job.indicators.invoiced)
    // The Job lists agree: not invoiced, still in progress
    const listed = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number }[]).map((row) => row.id)
    }
    assert.deepEqual(await listed('invoiced'), [])
    assert.deepEqual(await listed('closed'), [])
    assert.deepEqual(await listed('in_progress'), [job.id])

    // The next draft that bills everything takes back what is left, to the cent
    await cost('1000')
    const last = await Invoices.fromJob(job)
    assert.deepEqual(await deductionsOf(last), [[advance.id, '567.30']])
    assert.deepEqual(await pricesOf(last), ['1000.0000', '-465.0000'])
    await Invoices.finalise(last)
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoices: [{ id: advance.id, deduction: { deducted: '610.00', state: 'fully_deducted' } }],
      job: { indicators: { invoiced: true } },
    })
    assert.deepEqual(await listed('invoiced'), [job.id])
  })

  test('the draft page lists the advances it can take back, with what is left', async ({
    client,
  }) => {
    const { office, job, cost } = await costJob()
    const advance = await issuedAdvance(job, '100')
    await cost('200')
    const draft = await Invoices.fromJob(job)

    const page = await client.get(`/invoices/${draft.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      deductions: [
        {
          advanceId: advance.id,
          number: advance.formattedNumber,
          total: '122.00',
          left: '122.00',
          amount: '122.00',
        },
      ],
    })
    const own = await client.get(`/invoices/${advance.id}/edit`).withInertia().loginAs(office)
    own.assertInertiaPropsContains({ deductions: null })
  })

  test('a rejected advance is not corrected below what was taken back of it', async ({
    client,
    assert,
  }) => {
    const { office, job, cost } = await costJob()
    const advance = await issuedAdvance(job, '100')
    await cost('200')
    await Invoices.finalise(await Invoices.fromJob(job))
    await Submissions.prepare(advance)
    await Submissions.confirm(advance, 'Sconto')
    await Submissions.recordOutcome(advance, { outcome: 'rejected' })
    await advance.load('lines')
    const correct = (unitPrice: string) =>
      client
        .put(`/invoices/${advance.id}`)
        .json({ lines: [{ ...workLines(advance)[0], unitPrice }] })
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)

    const refused = await correct('50')
    refused.assertFlashMessage('error', it('flash.invoiceNotFinalisable.belowDeducted'))
    await advance.refresh()
    assert.equal(advance.total, '122.00')
    const kept = await correct('100')
    kept.assertFlashMessage('success', it('flash.invoiceSaved'))
  })

  test('a rejected advance keeps each VAT row at least what was taken back of it', async ({
    client,
    assert,
  }) => {
    const { office, job, cost } = await costJob()
    const reduced = await vatCode('10%')
    const standard = await vatCode()
    const advance = await Invoices.createAdvance(job)
    await Invoices.save(advance, {
      lines: [
        { description: 'Acconto', quantity: '1', unitPrice: '100', vatCodeId: standard.id },
        { description: 'Acconto', quantity: '1', unitPrice: '100', vatCodeId: reduced.id },
      ],
    })
    await Invoices.finalise(advance)
    // The final Invoice takes all of it back: 100 at each rate
    await cost('200')
    await Invoices.finalise(await Invoices.fromJob(job))
    await Submissions.prepare(advance)
    await Submissions.confirm(advance, 'Sconto')
    await Submissions.recordOutcome(advance, { outcome: 'rejected' })
    await advance.load('lines')
    const [first, second] = workLines(advance)
    const correct = (prices: [string, string]) =>
      client
        .put(`/invoices/${advance.id}`)
        .json({
          lines: [
            { ...first, unitPrice: prices[0] },
            { ...second, unitPrice: prices[1] },
          ],
        })
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)

    // 146.40 + 88.00 still covers the 232.00 taken back, but not at 10%
    const refused = await correct(['120', '80'])
    refused.assertFlashMessage('error', it('flash.invoiceNotFinalisable.belowDeductedRow'))
    await advance.refresh()
    assert.equal(advance.total, '232.00')
    const kept = await correct(['120', '100'])
    kept.assertFlashMessage('success', it('flash.invoiceSaved'))
  })

  test("a deduction is split over the advance's VAT rows; its lines follow it", async ({
    assert,
  }) => {
    const { job, cost } = await costJob()
    const reduced = await vatCode('10%')
    const standard = await vatCode()
    const advance = await Invoices.createAdvance(job)
    await Invoices.save(advance, {
      lines: [
        { description: 'Acconto', quantity: '1', unitPrice: '100', vatCodeId: standard.id },
        { description: 'Acconto', quantity: '1', unitPrice: '100', vatCodeId: reduced.id },
      ],
    })
    await Invoices.finalise(advance)
    await cost('1000')
    // A follow-up is still planned: this draft starts with no deduction
    await Visit.create({
      jobId: job.id,
      startsAt: DateTime.now().plus({ days: 1 }),
      endsAt: DateTime.now().plus({ days: 1, hours: 2 }),
      status: 'planned',
    })
    const draft = await Invoices.fromJob(job)
    assert.deepEqual(await deductionsOf(draft), [])
    await draft.load('lines')

    // 116 of 232: 61 at 22% and 55 at 10%, a taxable 50 each
    await Invoices.save(draft, {
      lines: workLines(draft),
      deductions: [{ advanceId: advance.id, amount: '116' }],
    })
    await advance.refresh()
    const lines = await linesOf(draft)
    assert.deepEqual(lines.slice(1), [
      [labelOf(advance), '-50.0000', '22.00'],
      [labelOf(advance), '-50.0000', '10.00'],
    ])

    // Deduction lines sent back changed are rewritten from the deduction
    await draft.load('lines')
    await Invoices.save(draft, {
      lines: draft.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.deductsInvoiceId ? '-1' : line.unitPrice,
        vatCodeId: line.deductsInvoiceId ? standard.id : line.vatCodeId,
        ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
      })),
    })
    assert.deepEqual(await pricesOf(draft), ['1000.0000', '-50.0000', '-50.0000'])
  })

  test('issued Invoices taking an advance back since the draft was saved refuse it', async ({
    client,
    assert,
  }) => {
    const { office, job, cost } = await costJob()
    const advance = await issuedAdvance(job, '100')
    await cost('200')
    const first = await Invoices.fromJob(job)
    await first.load('lines')
    // Issued without the deduction, then rejected
    await Invoices.save(first, { lines: workLines(first), deductions: [] })
    await Invoices.finalise(first)
    await Submissions.prepare(first)
    await Submissions.confirm(first, 'Sconto')
    await Submissions.recordOutcome(first, { outcome: 'rejected' })

    await cost('300')
    const second = await Invoices.fromJob(job)
    assert.deepEqual(await deductionsOf(second), [[advance.id, '122.00']])
    // The correction takes the advance back first
    await first.load('lines')
    await Invoices.save(first, {
      lines: workLines(first),
      deductions: [{ advanceId: advance.id, amount: '122' }],
    })

    const refused = await client
      .post(`/invoices/${second.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.invoiceNotFinalisable.deductionTooLarge'))
    await second.refresh()
    assert.equal(second.status, 'draft')
  })

  test('a Job with a Quote takes advances back like any Job, even one issued late', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const job = await acceptedJob()
    await issuedAdvance(job, '100')
    // Nothing else to bill: the draft takes back what is left (ADR 0011)
    const final = await Invoices.fromJob(job)
    assert.deepEqual(await pricesOf(final), ['1000.0000', '-100.0000'])
    await Invoices.finalise(final)

    // Issued after the Job's Invoice: a later Invoice takes it back
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoiceAdvance: true, canInvoice: false })
    const late = await issuedAdvance(job, '50')
    await Charges.add(
      job,
      { description: 'Extra', quantity: '1', unit: null, unitPrice: '200', vatKind: 'labour' },
      office
    )
    const last = await Invoices.fromJob(job)
    assert.deepEqual(await deductionsOf(last), [[late.id, '61.00']])
    assert.deepEqual(await pricesOf(last), ['200.0000', '-50.0000'])
    await Invoices.finalise(last)

    const after = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    after.assertInertiaPropsContains({ job: { indicators: { invoiced: true } } })
  })

  test('without a Quote: advances wait for the draft that bills the last of the work', async ({
    assert,
  }) => {
    await completeCompany()
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), {
      status: 'in_progress',
      workCategory: 'sale',
    })
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const start = DateTime.now().minus({ days: 1 })
    const done = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })
    await done.related('technicians').attach([anna.id])
    await FieldWork.recordHours(done, { technicianId: anna.id, labourRateId: rate.id, hours: '5' })
    await FieldWork.setStatus(done, 'done', anna)
    const followUp = await Visit.create({
      jobId: job.id,
      startsAt: start.plus({ hours: 3 }),
      endsAt: start.plus({ hours: 5 }),
      status: 'planned',
    })
    await issuedAdvance(job, '50')

    // A follow-up is still planned: this draft isn't the last
    const partial = await Invoices.fromJob(job)
    assert.deepEqual(await pricesOf(partial), ['40.0000'])
    await Invoices.finalise(partial)

    await followUp.related('technicians').attach([anna.id])
    await FieldWork.recordHours(followUp, {
      technicianId: anna.id,
      labourRateId: rate.id,
      hours: '2',
    })
    await FieldWork.setStatus(followUp, 'done', anna)
    const last = await Invoices.fromJob(job)
    assert.deepEqual(await pricesOf(last), ['40.0000', '-50.0000'])
  })

  test('only deduction lines may be negative; an Item line may not', async ({ client, assert }) => {
    const office = await createUser('office')
    const draft = await Invoices.create(await createCustomer())
    const item = await createItem()
    const standard = await vatCode()

    const response = await client
      .put(`/invoices/${draft.id}`)
      .json({
        lines: [
          {
            itemId: item.id,
            description: 'Reso',
            quantity: '1',
            unitPrice: '-10',
            vatCodeId: standard.id,
          },
        ],
      })
      .header('referer', `/invoices/${draft.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(response.flashMessage('inputErrorsBag'), ['lines.0.unitPrice'])
  })

  test('no advance for a closed or cancelled Job, and only Office or the Admin issue them', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    for (const status of ['closed', 'cancelled'] as const) {
      const ended = await createJob(await createCustomer(), { status })
      const refused = await client
        .post(`/jobs/${ended.id}/advance-invoices`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      refused.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
      const page = await client.get(`/jobs/${ended.id}`).withInertia().loginAs(office)
      page.assertInertiaPropsContains({ canInvoiceAdvance: false })
      assert.isNull(await Invoice.findBy('jobId', ended.id), status)
    }

    const job = await createJob(await createCustomer())
    for (const role of ['technician', 'superuser'] as const) {
      const denied = await client
        .post(`/jobs/${job.id}/advance-invoices`)
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(await createUser(role))
        .redirects(0)
      denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await Invoice.all(), 0)
  })
})

test.group('Advance deductions concurrently', () => {
  test('two Invoices taking back the rest of an advance at once: only one does', async ({
    assert,
    cleanup,
  }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)
    const { job, cost } = await costJob()
    const advance = await issuedAdvance(job, '100')
    await cost('200')
    const first = await Invoices.fromJob(job)
    await first.load('lines')
    await Invoices.save(first, { lines: workLines(first), deductions: [] })
    await Invoices.finalise(first)
    await Submissions.prepare(first)
    await Submissions.confirm(first, 'Sconto')
    await Submissions.recordOutcome(first, { outcome: 'rejected' })
    await cost('300')
    const second = await Invoices.fromJob(job)
    await first.load('lines')

    // Separate pooled connections: real row locks, unlike the global transaction
    const results = await Promise.allSettled([
      Invoices.save(first, {
        lines: workLines(first),
        deductions: [{ advanceId: advance.id, amount: '122' }],
      }),
      Invoices.finalise(second),
    ])

    const refused = results.filter((result) => result.status === 'rejected')
    assert.lengthOf(refused, 1)
    assert.equal(
      ((refused[0] as PromiseRejectedResult).reason as InvoiceNotFinalisableError).reason,
      'deductionTooLarge'
    )
    const [taken] = await Invoices.advancesOf(undefined, job.id)
    assert.equal(taken.deducted, '122.00')
  }).tags(['@committed'])
})
