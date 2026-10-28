import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import Visit from '#models/visit'
import VatCode from '#models/vat_code'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Payments from '#services/payments'
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
    // All its work is billed now: nothing left for another Invoice
    again.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 1)
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      canInvoice: false,
      timeAndMaterials: { total: '1362.50', billed: '1362.50' },
    })
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

  test('done work is invoiced while a follow-up is open; the follow-up goes on the next', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
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

    // The first Visit's four lines, not the open follow-up's hour
    const first = await Invoices.fromJob(job)
    await first.load('lines')
    assert.lengthOf(first.lines, 4)
    // While that draft is open, asking again returns it, and nothing more is offered
    const returned = await Invoices.fromJob(job)
    assert.equal(returned.id, first.id)
    let page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })

    // Issued and paid in full, but the follow-up is open: a partial Invoice,
    // so the Job is neither Invoiced nor Closed, in the list or on its page
    await Invoices.finalise(first)
    await first.refresh()
    await Payments.record(first, { amount: first.total!, paidOn: DateTime.now() })
    const listed = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number; status: string }[]).map((row) => [
        row.id,
        row.status,
      ])
    }
    assert.deepEqual(await listed('invoiced'), [])
    assert.deepEqual(await listed('closed'), [])
    assert.deepEqual(await listed('in_progress'), [[job.id, 'in_progress']])
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false, job: { status: 'in_progress' } })

    // Done, with its hour unbilled: Work Complete, ready for the next Invoice
    await FieldWork.setStatus(followUp, 'done', anna)
    assert.deepEqual(await listed('work_complete'), [[job.id, 'work_complete']])
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: true, job: { status: 'work_complete' } })
    const second = await Invoices.fromJob(job)
    await second.load('lines')
    assert.notEqual(second.id, first.id)
    assert.deepEqual(
      second.lines.map((line) => line.quantity),
      ['1.000']
    )

    // All billed and issued, the second unpaid: Invoiced
    await Invoices.finalise(second)
    assert.deepEqual(await listed('invoiced'), [[job.id, 'invoiced']])
  })

  test('deleting a draft frees its work for the next one', async ({ client, assert }) => {
    const office = await createUser('office')
    const { job, visit } = await workedJob()
    const draft = await Invoices.fromJob(job)
    // Editing the draft keeps its work billed
    await Invoices.save(draft, { lines: [] })
    let page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ timeAndMaterials: { billed: '1362.50' } })

    await client.delete(`/invoices/${draft.id}`).withCsrfToken().loginAs(office)
    await visit.load('hours')
    assert.isTrue(visit.hours.every((hour) => hour.invoiceId === null))
    page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: true, timeAndMaterials: { billed: '0.00' } })
    const again = await Invoices.fromJob(job)
    await again.load('lines')
    assert.lengthOf(again.lines, 4)
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
