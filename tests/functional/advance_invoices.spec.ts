import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Quotes from '#services/quotes'
import Submissions from '#services/submissions'
import { buildFatturaPA, fatturaInputFor } from '#fiscal/fattura_pa'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import type Job from '#models/job'

/**
 * A Quoted Job with an accepted Quote of 1,000.00 at 22%.
 */
async function acceptedJob() {
  const job = await createJob(await createCustomer(), { kind: 'quoted', workCategory: 'sale' })
  const standard = await vatCode()
  const rate = await LabourRate.create({ name: 'Lavori', hourlyPrice: '1000' })
  await Quotes.save(job, {
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
  await Quotes.accept(job)
  await job.refresh()
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
      job: { status: 'accepted' },
    })

    const final = await Invoices.fromJob(job)
    const label = `Detrazione acconto fattura ${advance.formattedNumber} del ${advance.issuedOn!.toFormat('dd/MM/yyyy')}`
    assert.deepEqual(await linesOf(final), [
      ['Lavori', '1000.0000', '22.00'],
      [label, '-300.0000', '22.00'],
    ])
    await advance.refresh()
    assert.equal(advance.deductedInId, final.id)
    assert.equal(final.totals.taxable, '700.00')

    // Office can edit the draft with its deduction line
    const saved = await client
      .put(`/invoices/${final.id}`)
      .json({
        lines: final.lines.map((line) => ({
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
      job: { status: 'invoiced' },
    })
  })

  test('deleting the final draft frees the advance for the next one', async ({ assert }) => {
    await completeCompany()
    const job = await acceptedJob()
    const advance = await issuedAdvance(job, '300')
    const first = await Invoices.fromJob(job)

    await Invoices.destroy(first)
    await advance.refresh()
    assert.isNull(advance.deductedInId)
    const second = await Invoices.fromJob(job)
    assert.lengthOf(await linesOf(second), 2)
  })

  test('Time & Materials: the first draft deducts the advance, later ones do not', async ({
    assert,
  }) => {
    await completeCompany()
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), {
      kind: 'time_and_materials',
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

  test('the final Invoice must take each advance back in full, and stay positive', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const job = await acceptedJob()
    await issuedAdvance(job, '300')
    const final = await Invoices.fromJob(job)
    await final.load('lines')
    const [work] = final.lines

    // Office removed the deduction line
    await Invoices.save(final, {
      lines: [
        {
          description: work.description,
          quantity: '1',
          unitPrice: '1000',
          vatCodeId: work.vatCodeId,
        },
      ],
    })
    const removed = await client
      .post(`/invoices/${final.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    removed.assertFlashMessage('error', it('flash.invoiceNotFinalisable.deductionsChanged'))

    // The work brought below the advance: the total would be negative
    await Invoices.destroy(final)
    const again = await Invoices.fromJob(job)
    await again.load('lines')
    await Invoices.save(again, {
      lines: again.lines.map((line, index) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: index === 0 ? '100' : line.unitPrice,
        vatCodeId: line.vatCodeId,
        ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
      })),
    })
    const negative = await client
      .post(`/invoices/${again.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    negative.assertFlashMessage('error', it('flash.invoiceNotFinalisable.negativeTotal'))
    await again.refresh()
    assert.equal(again.status, 'draft')
  })

  test('a deduction moved to another VAT rate is refused, also when correcting', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const job = await acceptedJob()
    await issuedAdvance(job, '300')
    const final = await Invoices.fromJob(job)
    await final.load('lines')
    const reduced = await vatCode('10%')
    const asSent = (vatOf: (index: number) => number) =>
      final.lines.map((line, index) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCodeId: vatOf(index),
        ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
      }))

    // The 22% advance taken back at 10% would return the wrong VAT
    await Invoices.save(final, {
      lines: asSent((index) => (index === 1 ? reduced.id : final.lines[index].vatCodeId)),
    })
    const moved = await client
      .post(`/invoices/${final.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    moved.assertFlashMessage('error', it('flash.invoiceNotFinalisable.deductionsChanged'))

    // Issued as drafted, then rejected: the correction is held to the same rules
    await Invoices.save(final, { lines: asSent((index) => final.lines[index].vatCodeId) })
    await Invoices.finalise(final)
    await Submissions.prepare(final)
    await Submissions.confirm(final, 'Sconto')
    await Submissions.recordOutcome(final, { outcome: 'rejected' })
    const correction = await client
      .put(`/invoices/${final.id}`)
      .json({ lines: asSent((index) => final.lines[index].vatCodeId).slice(0, 1) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    correction.assertFlashMessage('error', it('flash.invoiceNotFinalisable.deductionsChanged'))
    await final.load('lines')
    assert.lengthOf(final.lines, 2)
  })

  test("no advance once the Quote's Invoice exists, nor issued past its draft", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const job = await acceptedJob()
    // Drafted before the Quote's Invoice, issued after it was drafted
    const late = await Invoices.createAdvance(job)
    await late.load('lines')
    await Invoices.save(late, {
      lines: [
        {
          description: 'Acconto',
          quantity: '1',
          unitPrice: '100',
          vatCodeId: late.lines[0].vatCodeId,
        },
      ],
    })
    await Invoices.fromJob(job)

    const refused = await client
      .post(`/invoices/${late.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.invoiceNotFinalisable.jobInvoiced'))
    await late.refresh()
    assert.equal(late.status, 'draft')

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoiceAdvance: false })
    const another = await client
      .post(`/jobs/${job.id}/advance-invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    another.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
  })

  test('Time & Materials: advances wait for the draft that bills the last of the work', async ({
    assert,
  }) => {
    await completeCompany()
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), {
      kind: 'time_and_materials',
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
      startsAt: start.plus({ days: 3 }),
      endsAt: start.plus({ days: 3, hours: 2 }),
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

  test('no advance for a cancelled Job, and only Office or the Admin issue them', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const cancelled = await createJob(await createCustomer(), { status: 'cancelled' })
    const refused = await client
      .post(`/jobs/${cancelled.id}/advance-invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.jobNotInvoiceable'))

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
