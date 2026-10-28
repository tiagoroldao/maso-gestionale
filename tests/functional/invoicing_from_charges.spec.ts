import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'
import { VISIT_BILLED_SQL } from '#services/job_status'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { history, sqlStateOf, stateOf } from '#tests/helpers/charges'
import { it } from '#tests/helpers/i18n'
import type Job from '#models/job'
import type User from '#models/user'

/**
 * A Job without a Quote, with a done Visit (Anna's 2 hours at 40, three
 * valves at 7.50) and a call-out of 35 on the Job itself: 137.50 to bill.
 */
async function workedJob() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician', { fullName: 'Anna' })
  const job = await createJob(await createCustomer(), {
    status: 'in_progress',
    workCategory: 'sale',
  })
  const start = DateTime.fromISO('2026-10-20T09:00')
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 3 }),
    status: 'planned',
  })
  await visit.related('technicians').attach([anna.id])
  const rate = await LabourRate.firstOrCreate({ name: 'Idraulico' }, { hourlyPrice: '40' })
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })
  const hours = await FieldWork.recordHours(
    visit,
    { technicianId: anna.id, labourRateId: rate.id, hours: '2' },
    anna
  )
  const valves = await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '3' }, anna)
  await FieldWork.setStatus(visit, 'done', anna)
  const callOut = await Charges.add(
    job,
    { description: 'Uscita', quantity: '1', unit: null, unitPrice: '35', vatKind: 'labour' },
    office
  )
  return { office, anna, job, visit, rate, valve, hours, valves, callOut }
}

/**
 * The Charges each line of the Invoice bills, by line position.
 */
async function chargesByLine(invoice: Invoice) {
  const lines = await InvoiceLine.query()
    .where('invoiceId', invoice.id)
    .preload('charges', (charges) => charges.orderBy('id'))
    .orderBy('position')
  return lines.map((line) => line.charges.map((charge) => charge.id))
}

/**
 * The lines as the Invoice page sends them back, by default unchanged.
 */
async function asSent(invoice: Invoice) {
  const lines = await InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
  return lines.map((line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    vatCodeId: line.vatCodeId,
  }))
}

async function billedEvents(charge: Charge) {
  const events = await ChargeEvent.query()
    .where('chargeId', charge.id)
    .whereIn('kind', ['billed', 'unbilled'])
    .orderBy('id')
  return events.map((event) => [event.kind, event.invoiceId, event.invoiceLineId, event.amount])
}

async function jobPage(client: any, job: Job, user: User) {
  const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(user)
  return page as {
    inertiaProps: Record<string, any>
    assertInertiaPropsContains: (props: Record<string, unknown>) => void
  }
}

test.group('Invoicing from Charges', () => {
  test('a draft holds the Charges to bill; finalising bills each with its line and amount', async ({
    client,
    assert,
  }) => {
    const { office, job, hours, valves, callOut } = await workedJob()
    const draft = await Invoices.fromJob(job)

    // One line per Charge, each holding it
    assert.deepEqual(await chargesByLine(draft), [[hours.id], [valves.id], [callOut.id]])
    for (const charge of [hours, valves, callOut]) {
      assert.equal(await stateOf(charge), 'in_draft')
      assert.equal(await sqlStateOf(charge), 'in_draft')
      assert.deepEqual(await billedEvents(charge), [])
    }
    let page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({
      canInvoice: false,
      timeAndMaterials: { total: '137.50', billed: '0.00', inDraft: '137.50' },
      visits: [{ billed: false }],
    })

    await client.post(`/invoices/${draft.id}/finalise`).withCsrfToken().loginAs(office)
    const lines = await InvoiceLine.query().where('invoiceId', draft.id).orderBy('position')
    assert.deepEqual(await billedEvents(hours), [['billed', draft.id, lines[0].id, '80.00']])
    assert.deepEqual(await billedEvents(valves), [['billed', draft.id, lines[1].id, '22.50']])
    assert.deepEqual(await billedEvents(callOut), [['billed', draft.id, lines[2].id, '35.00']])
    for (const charge of [hours, valves, callOut]) {
      assert.equal(await stateOf(charge), 'billed')
      assert.equal(await sqlStateOf(charge), 'billed')
    }

    // What was billed adds up to the Invoice, and the Job is Invoiced
    page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({
      canInvoice: false,
      timeAndMaterials: { total: '137.50', billed: '137.50', inDraft: '0.00' },
      invoicedSoFar: { amount: '137.50', of: '137.50' },
      visits: [{ billed: true }],
      job: { status: 'invoiced' },
    })
  })

  test('removing a line releases its Charge; the rest is billed, the Job stays open', async ({
    client,
    assert,
  }) => {
    const { office, job, hours, valves, callOut } = await workedJob()
    const draft = await Invoices.fromJob(job)
    const [labour, valveLine] = await asSent(draft)
    const saved = await client
      .put(`/invoices/${draft.id}`)
      .json({ lines: [labour, valveLine] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    saved.assertFlashMessage('success', it('flash.invoiceSaved'))

    // Released without a trace in its history; the kept lines still hold theirs
    assert.equal(await stateOf(callOut), 'to_bill')
    assert.equal(await sqlStateOf(callOut), 'to_bill')
    assert.deepEqual(await history(callOut), ['recorded'])
    assert.deepEqual(await chargesByLine(draft), [[hours.id], [valves.id]])

    await Invoices.finalise(draft)
    const listed = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number }[]).map((row) => row.id)
    }
    // The call-out is still to bill: the Job isn't Invoiced, in the list or on its page
    assert.deepEqual(await listed('invoiced'), [])
    const page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({
      canInvoice: true,
      timeAndMaterials: { billed: '102.50' },
      visits: [{ billed: true }],
    })
    assert.notEqual(page.inertiaProps.job.status, 'invoiced')

    const next = await Invoices.fromJob(job)
    assert.deepEqual(await chargesByLine(next), [[callOut.id]])
    await Invoices.finalise(next)
    assert.deepEqual(await listed('invoiced'), [job.id])
  })

  test('one line can bill several Charges; its amount is split in proportion', async ({
    client,
    assert,
  }) => {
    const { office, job, hours, valves, callOut } = await workedJob()
    const other = await workedJob()
    const draft = await Invoices.fromJob(job)
    const [labour, , callOutLine] = await asSent(draft)

    // The valves merged into the hours line, for 100 in all; another Job's
    // Charge can't be slipped in
    await client
      .put(`/invoices/${draft.id}`)
      .json({
        lines: [
          {
            ...labour,
            quantity: '1',
            unitPrice: '100',
            chargeIds: [hours.id, valves.id, other.callOut.id],
          },
          callOutLine,
        ],
      })
      .withCsrfToken()
      .loginAs(office)
    assert.deepEqual(await chargesByLine(draft), [[hours.id, valves.id], [callOut.id]])
    assert.equal(await stateOf(valves), 'in_draft')
    assert.equal(await stateOf(other.callOut), 'to_bill')

    await Invoices.finalise(draft)
    const [line] = await InvoiceLine.query().where('invoiceId', draft.id).orderBy('position')
    // 100 × 80 / 102.50 and 100 × 22.50 / 102.50, rounded to add up to 100
    assert.deepEqual(await billedEvents(hours), [['billed', draft.id, line.id, '78.05']])
    assert.deepEqual(await billedEvents(valves), [['billed', draft.id, line.id, '21.95']])
    const page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({ timeAndMaterials: { billed: '135.00' } })
  })

  test('each line keeps the VAT sent; a deduction line bills no Charge', async ({
    client,
    assert,
  }) => {
    const { office, job, hours, valves, callOut } = await workedJob()
    const draft = await Invoices.fromJob(job)
    const [labour, valveLine, callOutLine] = await asSent(draft)
    const reduced = await vatCode('10%')
    const standard = await vatCode()

    // The hours at 22%, the valves at 10%; a line sent as a deduction is
    // dropped (deductions write their own lines, ADR 0011), and can't take
    // a Charge, so the call-out is released
    await client
      .put(`/invoices/${draft.id}`)
      .json({
        lines: [
          { ...labour, vatCodeId: standard.id, chargeIds: [hours.id] },
          { ...valveLine, vatCodeId: reduced.id },
          { ...callOutLine, deductsInvoiceId: draft.id, chargeIds: [callOut.id] },
        ],
      })
      .withCsrfToken()
      .loginAs(office)
    const lines = await InvoiceLine.query().where('invoiceId', draft.id).orderBy('position')
    assert.deepEqual(
      lines.map((line) => [line.vatCodeId, line.vatRate]),
      [
        [standard.id, '22.00'],
        [reduced.id, '10.00'],
      ]
    )
    assert.deepEqual(await chargesByLine(draft), [[hours.id], [valves.id]])
    assert.equal(await stateOf(callOut), 'to_bill')
  })

  test('the Admin sets a billed Charge back to bill too', async ({ client, assert }) => {
    const { job, callOut } = await workedJob()
    await Invoices.finalise(await Invoices.fromJob(job))

    const response = await client
      .post(`/charges/${callOut.id}/to-bill`)
      .withCsrfToken()
      .loginAs(await createUser('admin'))
      .redirects(0)
    response.assertFlashMessage('success', it('flash.chargeSetBackToBill'))
    assert.equal(await stateOf(callOut), 'to_bill')
  })

  test('a billed Charge is set back to bill, edited and billed again', async ({
    client,
    assert,
  }) => {
    const { office, job, hours, callOut } = await workedJob()

    // Only a billed Charge can be set back
    let refused = await client
      .post(`/charges/${callOut.id}/to-bill`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.chargeRefused.notBilled'))
    const first = await Invoices.fromJob(job)
    refused = await client
      .post(`/charges/${callOut.id}/to-bill`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.chargeRefused.notBilled'))
    await Invoices.finalise(first)

    const response = await client
      .post(`/charges/${callOut.id}/to-bill`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.chargeSetBackToBill'))
    response.assertHeader('location', `/charges/${callOut.id}/edit`)
    assert.deepEqual(await history(callOut), ['recorded', 'billed', 'unbilled'])
    const unbilled = await ChargeEvent.query()
      .where('chargeId', callOut.id)
      .where('kind', 'unbilled')
      .firstOrFail()
    assert.equal(unbilled.invoiceId, first.id)
    assert.equal(unbilled.userId, office.id)
    assert.equal(await stateOf(callOut), 'to_bill')
    assert.equal(await sqlStateOf(callOut), 'to_bill')
    // The Invoice is unchanged, the Job no longer Invoiced
    await first.load('lines')
    assert.lengthOf(first.lines, 3)
    let page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({ canInvoice: true, timeAndMaterials: { billed: '102.50' } })
    assert.notEqual(page.inertiaProps.job.status, 'invoiced')

    // Its billing is editable again; the next Invoice bills it as edited
    const edited = await client
      .put(`/charges/${callOut.id}/billing`)
      .form({ quantity: '1', unitPrice: '20', description: 'Seconda uscita', vatKind: 'labour' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    edited.assertFlashMessage('success', it('flash.chargeBillingSaved'))
    const second = await Invoices.fromJob(job)
    await Invoices.finalise(second)
    assert.deepEqual(await history(callOut), [
      'recorded',
      'billed',
      'unbilled',
      'billing_edited',
      'billed',
    ])
    const [line] = await InvoiceLine.query().where('invoiceId', second.id)
    const rebilled = await billedEvents(callOut)
    assert.deepEqual(rebilled.at(-1), ['billed', second.id, line.id, '20.00'])
    assert.equal(await stateOf(hours), 'billed')
    page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({
      timeAndMaterials: { total: '122.50', billed: '122.50' },
      invoicedSoFar: { amount: '157.50' },
      job: { status: 'invoiced' },
    })
  })

  test('a released Charge follows what was recorded, unless Office edited its billing', async ({
    client,
    assert,
  }) => {
    const { office, job, hours, valves, anna } = await workedJob()
    await client
      .put(`/charges/${valves.id}/billing`)
      .form({ quantity: '3', unitPrice: '7', description: 'Valvole' })
      .withCsrfToken()
      .loginAs(office)
    const draft = await Invoices.fromJob(job)

    // Corrected while the draft holds them: what is billed stays as drafted
    const expert = await LabourRate.create({ name: 'Esperto', hourlyPrice: '50' })
    await client
      .put(`/charges/${hours.id}/recorded`)
      .form({ labourRateId: String(expert.id), technicianId: String(anna.id), quantity: '3' })
      .withCsrfToken()
      .loginAs(office)
    await client
      .put(`/charges/${valves.id}/recorded`)
      .form({ itemId: String(valves.itemId), quantity: '4' })
      .withCsrfToken()
      .loginAs(office)
    await hours.refresh()
    assert.deepEqual([hours.billQuantity, hours.unitPrice], ['2.000', '40.0000'])

    await client.delete(`/invoices/${draft.id}`).withCsrfToken().loginAs(office)
    await hours.refresh()
    await valves.refresh()
    assert.deepEqual(
      [hours.billQuantity, hours.unitPrice, hours.description],
      ['3.000', '50.0000', 'Esperto – Anna']
    )
    assert.deepEqual(
      [valves.quantity, valves.billQuantity, valves.unitPrice, valves.description],
      ['4.000', '3.000', '7.0000', 'Valvole']
    )
  })

  test('correcting a rejected Invoice sets back a removed line and rebills a changed one', async ({
    client,
    assert,
  }) => {
    const { office, job, hours, valves, callOut } = await workedJob()
    const invoice = await Invoices.fromJob(job)
    await Invoices.finalise(invoice)
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })
    const [labour, valveLine, callOutLine] = await asSent(invoice)

    const saved = await client
      .put(`/invoices/${invoice.id}`)
      .json({ lines: [{ ...labour, unitPrice: '45' }, valveLine] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    saved.assertFlashMessage('success', it('flash.invoiceSaved'))

    assert.deepEqual(await billedEvents(callOut), [
      ['billed', invoice.id, callOutLine.id, '35.00'],
      ['unbilled', invoice.id, null, null],
    ])
    assert.equal(await stateOf(callOut), 'to_bill')
    const amounts = async (charge: Charge) => {
      const rows = await billedEvents(charge)
      return rows.map((row) => row[3])
    }
    assert.deepEqual(await amounts(hours), ['80.00', '90.00'])
    assert.deepEqual(await amounts(valves), ['22.50'])
    const page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({ canInvoice: true, timeAndMaterials: { billed: '112.50' } })
  })

  test('a Visit is billed the same way on the Job page and in SQL', async ({ client, assert }) => {
    const { office, job, visit, hours, valves } = await workedJob()
    const billedInSql = async () => {
      const row = await db
        .from('visits as v')
        .where('v.id', visit.id)
        .select(db.raw(`${VISIT_BILLED_SQL('v')} AS billed`))
        .firstOrFail()
      return row.billed as boolean
    }
    const onPage = async () => {
      const page = await jobPage(client, job, office)
      return page.inertiaProps.visits[0].billed as boolean
    }

    assert.deepEqual([await onPage(), await billedInSql()], [false, false])
    const draft = await Invoices.fromJob(job)
    assert.deepEqual([await onPage(), await billedInSql()], [false, false])
    await Invoices.finalise(draft)
    assert.deepEqual([await onPage(), await billedInSql()], [true, true])
    await Charges.setBackToBill(valves, office)
    assert.deepEqual([await onPage(), await billedInSql()], [false, false])
    await Charges.setBillable(valves, false, office)
    assert.deepEqual([await onPage(), await billedInSql()], [true, true])
    assert.deepEqual(
      [await stateOf(valves), await sqlStateOf(valves)],
      ['not_billable', 'not_billable']
    )
    assert.equal(await stateOf(hours), 'billed')
  })

  test('a billed Charge on the Job leaves nothing to invoice, and the Job is guarded', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const job = await createJob(await createCustomer(), {
      status: 'in_progress',
    })
    const callOut = await Charges.add(
      job,
      { description: 'Uscita', quantity: '1', unit: null, unitPrice: '35', vatKind: 'labour' },
      office
    )
    const draft = await Invoices.fromJob(job)

    // With Invoices, it can't be cancelled or moved to another Customer
    const cancel = await client
      .post(`/jobs/${job.id}/cancel`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    cancel.assertFlashMessage('error', it('flash.jobInvoiced'))
    const other = await createCustomer()
    const moved = await client
      .put(`/jobs/${job.id}`)
      .form({
        customerId: String(other.id),
        workCategory: 'maintenance',
        title: job.title,
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    moved.assertFlashMessage('error', it('flash.jobCustomerInvoiced'))

    await Invoices.finalise(draft)
    const page = await jobPage(client, job, office)
    page.assertInertiaPropsContains({ canInvoice: false, job: { status: 'invoiced' } })
    assert.equal(await stateOf(callOut), 'billed')
    const again = await client
      .post(`/jobs/${job.id}/invoices`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertFlashMessage('error', it('flash.jobNotInvoiceable'))
    await job.refresh()
    assert.equal(job.status, 'in_progress')
    assert.equal(job.customerId, draft.customerId)
  })
})

test.group('Invoicing from Charges concurrently', () => {
  test('drafts asked for at once give one draft holding each Charge once', async ({
    assert,
    cleanup,
  }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), {
      status: 'in_progress',
    })
    for (const price of ['35', '20', '15']) {
      await Charges.add(
        job,
        { description: 'Costo', quantity: '1', unit: null, unitPrice: price, vatKind: 'labour' },
        office
      )
    }

    // Separate pooled connections: real row locks, unlike the global transaction
    const drafts = await Promise.all([1, 2, 3, 4].map(() => Invoices.fromJob(job)))

    assert.lengthOf(new Set(drafts.map((draft) => draft.id)), 1)
    const links = await db
      .from('invoice_line_charges as lc')
      .join('charges as c', 'c.id', 'lc.charge_id')
      .where('c.job_id', job.id)
      .select('lc.charge_id')
    assert.lengthOf(links, 3)
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 1)
  }).tags(['@committed'])

  test('setting a Charge back to bill while its Invoice is drafted again stays consistent', async ({
    assert,
    cleanup,
  }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)
    await completeCompany()
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), {
      status: 'in_progress',
    })
    const charge = await Charges.add(
      job,
      { description: 'Costo', quantity: '1', unit: null, unitPrice: '35', vatKind: 'labour' },
      office
    )
    await Invoices.finalise(await Invoices.fromJob(job))

    // Set back and drafted at once: either the draft holds it, or it waits
    const [, drafted] = await Promise.allSettled([
      Charges.setBackToBill(charge, office),
      Invoices.fromJob(job),
    ])
    const state = await stateOf(charge)
    const links = await db.from('invoice_line_charges').where('charge_id', charge.id)
    if (drafted.status === 'fulfilled') {
      assert.equal(state, 'in_draft')
      assert.lengthOf(links, 2)
    } else {
      assert.equal(state, 'to_bill')
      assert.lengthOf(links, 1)
    }
    assert.equal(await sqlStateOf(charge), state)
  }).tags(['@committed'])
})
