import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Quotes from '#services/quotes'
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
