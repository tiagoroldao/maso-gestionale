import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import Visit from '#models/visit'
import VatCode from '#models/vat_code'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

/**
 * A Time & Materials Job with one done Visit: hours by two Technicians
 * and two Items used (one with a 10% default code).
 */
async function workedJob() {
  const anna = await createUser('technician', { fullName: 'Anna' })
  const bruno = await createUser('technician', { fullName: 'Bruno' })
  const site = await createSite()
  const job = await createJob(await createCustomer(), {
    kind: 'time_and_materials',
    status: 'in_progress',
    siteId: site.id,
  })
  const start = DateTime.fromISO('2026-10-20T09:00')
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 3 }),
    status: 'planned',
  })
  await visit.related('technicians').attach([anna.id, bruno.id])
  const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
  const reduced = await vatCode('10%')
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })
  const boiler = await createItem({
    description: 'Caldaia',
    unit: 'pz',
    resalePrice: '1200',
    vatCodeId: reduced.id,
  })
  await FieldWork.recordHours(visit, { technicianId: anna.id, labourRateId: rate.id, hours: '2.5' })
  await FieldWork.recordHours(visit, { technicianId: bruno.id, labourRateId: rate.id, hours: '1' })
  await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '3' })
  await FieldWork.recordItem(visit, { itemId: boiler.id, quantity: '1' })
  await FieldWork.setStatus(visit, 'done', anna)
  return { job, rate, valve, boiler, visit, anna }
}

test.group('Invoices from Time & Materials Jobs', () => {
  test('one line per hours entry and Item, at the prices recorded with the work', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { job, rate, valve, boiler } = await workedJob()
    // A later price change doesn't touch work already recorded
    rate.hourlyPrice = '45'
    await rate.save()

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
    assert.deepEqual(
      invoice.lines.map((l) => [
        l.description,
        l.quantity,
        l.unit,
        l.unitPrice,
        l.natura,
        l.itemId,
      ]),
      // Maintenance for a company: the default rules give reverse charge
      [
        ['Idraulico – Anna (20/10)', '2.500', 'h', '40.0000', 'N6.7', null],
        ['Idraulico – Bruno (20/10)', '1.000', 'h', '40.0000', 'N6.7', null],
        ['Valvola (20/10)', '3.000', 'pz', '7.5000', 'N6.7', valve.id],
        ['Caldaia (20/10)', '1.000', 'pz', '1200.0000', 'N6.7', boiler.id],
      ]
    )

    // Before VAT, the draft equals the Job page's running total
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    const running = (page.inertiaProps.timeAndMaterials as { total: string }).total
    assert.equal(invoice.totals.taxable, running)
    assert.equal(running, '1362.50')
  })

  test('the work is invoiced once, and its Items leave stock only through the Visit', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { job, valve } = await workedJob()
    const usedBefore = await StockMovement.query().where('itemId', valve.id)
    const invoice = await Invoices.fromJob(job)
    await Invoices.finalise(invoice)

    assert.lengthOf(await StockMovement.query().where('itemId', valve.id), usedBefore.length)
    const again = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertHeader('location', `/invoices/${invoice.id}/edit`)
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 1)
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })
  })

  test('a Job with no recorded work has nothing to invoice', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { kind: 'time_and_materials' })

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })
    const response = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    assert.lengthOf(await Invoice.all(), 0)
  })

  test('work on Visits still open is not invoiced yet', async ({ client, assert }) => {
    const office = await createUser('office')
    const { job, anna, rate } = await workedJob()
    const start = DateTime.now().plus({ days: 1 })
    const followUp = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })
    await followUp.related('technicians').attach([anna.id])
    await FieldWork.recordHours(followUp, {
      technicianId: anna.id,
      labourRateId: rate.id,
      hours: '1',
    })

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })
    const response = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    assert.lengthOf(await Invoice.all(), 0)

    await FieldWork.setStatus(followUp, 'done', anna)
    const ready = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    ready.assertInertiaPropsContains({ canInvoice: true })
  })

  test("a rule's archived VAT Code gives way to the standard rate", async ({ assert }) => {
    const { job, boiler } = await workedJob()
    const reverseCharge = await VatCode.findByOrFail('natura', 'N6.7')
    reverseCharge.archivedAt = DateTime.now()
    await reverseCharge.save()

    const invoice = await Invoices.fromJob(job)
    await invoice.load('lines')
    const line = invoice.lines.find((l) => l.itemId === boiler.id)!
    assert.equal(line.vatRate, '22.00')
  })

  test('a cancelled Time & Materials Job is not invoiced', async ({ client, assert }) => {
    const office = await createUser('office')
    const { job } = await workedJob()
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })
    const response = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    assert.lengthOf(await Invoice.all(), 0)
  })
})
