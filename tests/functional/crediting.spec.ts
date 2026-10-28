import { test } from '@japa/runner'
import type { Assert } from '@japa/assert'
import { DateTime } from 'luxon'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import type Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
import type User from '#models/user'
import Visit from '#models/visit'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Invoices, { InvoiceNotFinalisableError } from '#services/invoices'
import Jobs, { type JobLeftovers } from '#services/jobs'
import Submissions from '#services/submissions'
import {
  ADVANCE_DEDUCTED_SQL,
  ADVANCE_TAKEN_BACK_SQL,
  VISIT_BILLED_SQL,
} from '#services/job_status'
import { advanceState } from '#shared/advances'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { history, sqlStateOf, stateOf } from '#tests/helpers/charges'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * A Job (a sale: 22% on labour) with a closed Visit, on which Anna
 * recorded 2 hours at 40 (80.00), and two other costs on the Job itself
 * (60.00 and 40.00).
 */
async function setup() {
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
  const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
  const hours = await FieldWork.recordHours(
    visit,
    { technicianId: anna.id, labourRateId: rate.id, hours: '2' },
    anna
  )
  await FieldWork.setStatus(visit, 'done', anna)
  const cost = (description: string, price: string) =>
    Charges.add(
      job,
      { description, quantity: '1', unit: null, unitPrice: price, vatKind: 'labour' },
      office
    )
  const pipe = await cost('Tubo', '60')
  const valve = await cost('Valvola', '40')
  return { office, anna, job, visit, hours, pipe, valve }
}

/**
 * Takes a finalised Invoice (or Credit Note) through a Submission to SDI's
 * `outcome`.
 */
async function sentTo(invoice: Invoice, outcome: 'delivered' | 'rejected') {
  await Submissions.prepare(invoice)
  await Submissions.confirm(invoice, 'Sconto')
  await Submissions.recordOutcome(invoice, { outcome })
  await invoice.refresh()
  return invoice
}

/**
 * The Job's Invoice from its Charges, finalised and delivered.
 */
async function invoiced(job: Job) {
  const invoice = await Invoices.fromJob(job)
  await Invoices.finalise(invoice)
  await invoice.refresh()
  return sentTo(invoice, 'delivered')
}

async function linesOf(invoice: Invoice) {
  return InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
}

/**
 * A draft's total, as its page shows it (drafts store none).
 */
async function draftTotal(invoice: Invoice) {
  const loaded = await Invoice.query().where('id', invoice.id).preload('lines').firstOrFail()
  return loaded.totals.total
}

async function amountsOf(invoice: Invoice) {
  const lines = await linesOf(invoice)
  return lines.map((line) => line.lineTotal)
}

async function leftToClose(job: Job, key: keyof JobLeftovers) {
  const left = await Jobs.leftToClose(job.id)
  return left[key]
}

/**
 * The Invoice's line billing `charge`.
 */
async function lineOf(invoice: Invoice, charge: Charge) {
  const row = await db
    .from('invoice_line_charges as lc')
    .join('invoice_lines as l', 'l.id', 'lc.invoice_line_id')
    .where('l.invoice_id', invoice.id)
    .where('lc.charge_id', charge.id)
    .select('l.id')
    .firstOrFail()
  return InvoiceLine.findOrFail(row.id)
}

/**
 * The Credit Note's lines as the page sends them: `credits` gives, for
 * each of the Invoice's lines credited, its unit price before VAT
 * (quantity 1). Lines of the Invoice left out aren't credited.
 */
function creditLines(credits: [InvoiceLine, string][]) {
  return credits.map(([line, unitPrice]) => ({
    creditsLineId: line.id,
    description: line.description,
    quantity: '1',
    unitPrice,
    vatCodeId: line.vatCodeId,
    ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
  }))
}

/**
 * A draft Credit Note for `invoice` (or the one open) crediting `credits`.
 */
async function creditNote(invoice: Invoice, credits: [InvoiceLine, string][]) {
  const note = await Invoices.createCreditNote(invoice)
  await Invoices.save(note, { lines: creditLines(credits) })
  await note.refresh()
  return note
}

function put(client: ApiClient, note: Invoice, user: User, body: Record<string, unknown>) {
  return client
    .put(`/invoices/${note.id}`)
    .json(body)
    .header('referer', `/invoices/${note.id}/edit`)
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

function post(client: ApiClient, url: string, user: User) {
  return client.post(url).header('referer', '/').withCsrfToken().loginAs(user).redirects(0)
}

/**
 * The Charge's state in TypeScript and SQL, asserted to agree.
 */
async function bothStates(assert: Assert, charge: Charge) {
  const state = await stateOf(charge)
  assert.equal(await sqlStateOf(charge), state)
  return state
}

async function refused(assert: Assert, work: () => Promise<unknown>, reason: string) {
  try {
    await work()
  } catch (error) {
    assert.instanceOf(error, InvoiceNotFinalisableError)
    assert.equal((error as InvoiceNotFinalisableError).reason, reason)
    return
  }
  assert.fail(`expected a refusal (${reason})`)
}

async function billingOpen(job: Job) {
  const row = await Job.query()
    .withScopes((scopes) => scopes.withBillingState())
    .where('id', job.id)
    .firstOrFail()
  return Boolean(row.$extras.billing_open)
}

async function visitBilledSql(visit: Visit) {
  const row = await db
    .from('visits as v')
    .where('v.id', visit.id)
    .select(db.raw(`${VISIT_BILLED_SQL('v')} AS billed`))
    .firstOrFail()
  return Boolean(row.billed)
}

test.group('Credit Notes credit Charges', () => {
  test('a line credited in full credits its Charges; one credited in part leaves them billed', async ({
    client,
    assert,
  }) => {
    const { office, job, visit, hours, pipe, valve } = await setup()
    const invoice = await invoiced(job)
    const hoursLine = await lineOf(invoice, hours)
    const pipeLine = await lineOf(invoice, pipe)
    const valveLine = await lineOf(invoice, valve)
    // The hours and the pipe in full, 10 of the valve's 40
    const note = await creditNote(invoice, [
      [hoursLine, '80'],
      [pipeLine, '60'],
      [valveLine, '10'],
    ])
    // A draft credits nothing yet
    assert.equal(await bothStates(assert, hours), 'billed')

    const response = await post(client, `/invoices/${note.id}/finalise`, office)
    await note.refresh()
    response.assertFlashMessage(
      'success',
      it('flash.creditNoteFinalised', { number: note.formattedNumber })
    )
    assert.equal(await bothStates(assert, hours), 'credited')
    assert.equal(await bothStates(assert, pipe), 'credited')
    assert.equal(await bothStates(assert, valve), 'billed')
    assert.deepEqual(await history(pipe), ['recorded', 'billed', 'credited'])
    const credited = await ChargeEvent.query()
      .where('chargeId', pipe.id)
      .where('kind', 'credited')
      .firstOrFail()
    assert.equal(credited.invoiceId, note.id)
    assert.equal(credited.invoiceLineId, pipeLine.id)
    assert.equal(credited.userId, office.id)

    // Credited is final: nothing outstanding, the Visit billed, the Job
    // invoiced, in TypeScript and SQL
    assert.isFalse(await billingOpen(job))
    assert.isTrue(await visitBilledSql(visit))
    assert.equal(await leftToClose(job, 'charges'), 0)
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      job: { indicators: { invoiced: true } },
      visits: [{ id: visit.id, billed: true }],
      canInvoice: false,
    })
    const charges = page.inertiaProps.charges as { id: number; state: string }[]
    assert.equal(charges.find((charge) => charge.id === pipe.id)!.state, 'credited')
  })

  test('a line credited in full across several Credit Notes credits its Charges', async ({
    assert,
  }) => {
    const { job, pipe } = await setup()
    const invoice = await invoiced(job)
    const pipeLine = await lineOf(invoice, pipe)

    const first = await creditNote(invoice, [[pipeLine, '25']])
    await Invoices.finalise(first)
    assert.equal(await bothStates(assert, pipe), 'billed')
    // The draft starts with what is left of the line
    const second = await Invoices.createCreditNote(invoice)
    const prefilled = await linesOf(second)
    const left = prefilled.find((line) => line.creditsLineId === pipeLine.id)!
    assert.equal(left.lineTotal, '35.00')
    await Invoices.save(second, { lines: creditLines([[pipeLine, '35']]) })
    await Invoices.finalise(second)
    assert.equal(await bothStates(assert, pipe), 'credited')
    assert.deepEqual(await history(pipe), ['recorded', 'billed', 'credited'])
  })

  test('Office sets a credited Charge back to bill, to bill it again', async ({
    client,
    assert,
  }) => {
    const { office, job, pipe } = await setup()
    const invoice = await invoiced(job)
    await Invoices.finalise(await creditNote(invoice, [[await lineOf(invoice, pipe), '60']]))
    assert.equal(await bothStates(assert, pipe), 'credited')

    // What is billed stays frozen until then
    const edit = await client
      .put(`/charges/${pipe.id}/billing`)
      .form({ quantity: '1', unitPrice: '50', description: 'Tubo' })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    edit.assertFlashMessage('error', it('flash.chargeRefused.credited'))
    const notBillable = await post(client, `/charges/${pipe.id}/not-billable`, office)
    notBillable.assertFlashMessage('error', it('flash.chargeRefused.credited'))
    assert.equal(await bothStates(assert, pipe), 'credited')

    const page = await client.get(`/charges/${pipe.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ charge: { state: 'credited' } })

    const back = await post(client, `/charges/${pipe.id}/to-bill`, office)
    back.assertFlashMessage('success', it('flash.chargeSetBackToBill'))
    assert.equal(await bothStates(assert, pipe), 'to_bill')
    assert.deepEqual(await history(pipe), ['recorded', 'billed', 'credited', 'unbilled'])
    const unbilled = await ChargeEvent.query()
      .where('chargeId', pipe.id)
      .where('kind', 'unbilled')
      .firstOrFail()
    assert.equal(unbilled.invoiceId, invoice.id)
    assert.isTrue(await billingOpen(job))

    // Billed again by the next Invoice
    const next = await Invoices.fromJob(job)
    const lines = await linesOf(next)
    assert.lengthOf(lines, 1)
    assert.equal(lines[0].lineTotal, '60.00')
    await Invoices.finalise(next)
    assert.equal(await bothStates(assert, pipe), 'billed')
    // A Credit Note on the first Invoice no longer reaches it
    assert.deepEqual(await history(pipe), ['recorded', 'billed', 'credited', 'unbilled', 'billed'])
  })

  test('a rejected Credit Note corrected below the line gives its Charges back their billing', async ({
    client,
    assert,
  }) => {
    const { office, job, pipe, valve } = await setup()
    const invoice = await invoiced(job)
    const pipeLine = await lineOf(invoice, pipe)
    const valveLine = await lineOf(invoice, valve)
    const note = await creditNote(invoice, [[pipeLine, '60']])
    await Invoices.finalise(note)
    await sentTo(note, 'rejected')
    // A rejected Credit Note still credits (it keeps its number)
    assert.equal(await bothStates(assert, pipe), 'credited')

    const [line] = await linesOf(note)
    const lower = await put(client, note, office, {
      lines: [{ ...creditLines([[pipeLine, '50']])[0], id: line.id }],
    })
    lower.assertFlashMessage('success', it('flash.invoiceSaved'))
    // Billed again by the Invoice, so still nothing to bill
    assert.equal(await bothStates(assert, pipe), 'billed')
    assert.deepEqual(await history(pipe), ['recorded', 'billed', 'credited', 'uncredited'])
    assert.isFalse(await billingOpen(job))

    // Corrected again to credit the pipe and the valve in full
    await put(client, note, office, {
      lines: [
        { ...creditLines([[pipeLine, '60']])[0], id: line.id },
        ...creditLines([[valveLine, '40']]),
      ],
    })
    assert.equal(await bothStates(assert, pipe), 'credited')
    assert.equal(await bothStates(assert, valve), 'credited')
    assert.deepEqual(await history(pipe), [
      'recorded',
      'billed',
      'credited',
      'uncredited',
      'credited',
    ])
  })

  test('a line credits at most its amount, across Credit Notes, and never a negative one', async ({
    client,
    assert,
  }) => {
    const { office, job, pipe, valve } = await setup()
    const invoice = await invoiced(job)
    const pipeLine = await lineOf(invoice, pipe)
    const valveLine = await lineOf(invoice, valve)
    const note = await Invoices.createCreditNote(invoice)
    const before = await amountsOf(note)

    // 60.01 on the 60.00 line, well within the Invoice's total
    const above = await put(client, note, office, { lines: creditLines([[pipeLine, '60.01']]) })
    above.assertFlashMessage('error', it('flash.invoiceNotFinalisable.lineCreditTooLarge'))
    // Two lines on one line count together
    const twice = await put(client, note, office, {
      lines: creditLines([
        [pipeLine, '30'],
        [pipeLine, '30.01'],
      ]),
    })
    twice.assertFlashMessage('error', it('flash.invoiceNotFinalisable.lineCreditTooLarge'))
    // A negative price is refused (a quantity is never negative)
    const negative = await put(client, note, office, {
      lines: creditLines([
        [pipeLine, '20'],
        [valveLine, '-5'],
      ]),
    })
    negative.assertFlashMessage('error', it('flash.invoiceNotFinalisable.negativeCredit'))
    assert.deepEqual(await amountsOf(note), before)

    // 50 now, then only 10 is left of the line
    await Invoices.save(note, { lines: creditLines([[pipeLine, '50']]) })
    await Invoices.finalise(note)
    const second = await Invoices.createCreditNote(invoice)
    const more = await put(client, second, office, { lines: creditLines([[pipeLine, '10.01']]) })
    more.assertFlashMessage('error', it('flash.invoiceNotFinalisable.lineCreditTooLarge'))
    // Another draft saved earlier is refused when finalised
    await Invoices.save(second, { lines: creditLines([[pipeLine, '10']]) })
    const third = await Invoice.create({
      customerId: invoice.customerId,
      status: 'draft',
      documentType: 'credit_note',
      creditsInvoiceId: invoice.id,
    })
    await Invoices.save(third, { lines: creditLines([[pipeLine, '5']]) })
    await Invoices.finalise(second)
    await refused(assert, () => Invoices.finalise(third), 'lineCreditTooLarge')
    await third.refresh()
    assert.equal(third.status, 'draft')
  })

  test("a Credit Note carries its Invoice's global discount", async ({ assert }) => {
    const { job, pipe } = await setup()
    const draft = await Invoices.fromJob(job)
    const lines = await linesOf(draft)
    await Invoices.save(draft, {
      discountPercent: '10',
      lines: lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCodeId: line.vatCodeId,
      })),
    })
    await Invoices.finalise(draft)
    const invoice = await sentTo(await Invoice.findOrFail(draft.id), 'delivered')
    const pipeLine = await lineOf(invoice, pipe)

    const note = await Invoices.createCreditNote(invoice)
    await Invoices.save(note, { discountPercent: '0', lines: creditLines([[pipeLine, '60']]) })
    await note.refresh()
    assert.equal(note.discountPercent, '10.00')
    await Invoices.finalise(note)
    await note.refresh()
    // 60 less 10%, plus 22%
    assert.equal(note.total, '65.88')
    assert.equal(await bothStates(assert, pipe), 'credited')
  })

  test('Technicians and the Superuser can not set a credited Charge back to bill; Admins can', async ({
    client,
    assert,
  }) => {
    const { job, pipe } = await setup()
    const invoice = await invoiced(job)
    await Invoices.finalise(await creditNote(invoice, [[await lineOf(invoice, pipe), '60']]))
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      const response = await post(client, `/charges/${pipe.id}/to-bill`, user)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      const page = await client.get(`/charges/${pipe.id}/edit`).withInertia().loginAs(user)
      page.assertStatus(403)
    }
    assert.equal(await bothStates(assert, pipe), 'credited')

    const admin = await createUser('admin')
    const response = await post(client, `/charges/${pipe.id}/to-bill`, admin)
    response.assertFlashMessage('success', it('flash.chargeSetBackToBill'))
    assert.equal(await bothStates(assert, pipe), 'to_bill')
  })
})

/**
 * An Advance Invoice of `amount` before VAT (22%) for the Job, issued and
 * delivered.
 */
async function issuedAdvance(job: Job, amount: string) {
  const advance = await Invoices.createAdvance(job)
  const [line] = await linesOf(advance)
  await Invoices.save(advance, {
    lines: [
      {
        id: line.id,
        description: line.description,
        quantity: '1',
        unitPrice: amount,
        vatCodeId: line.vatCodeId,
      },
    ],
  })
  await Invoices.finalise(advance)
  await advance.refresh()
  return sentTo(advance, 'delivered')
}

/**
 * The advance's deducted and taken back amounts in SQL, and its state as
 * advanceState() gives it from the Invoices service, asserted to agree.
 */
async function advanceOf(assert: Assert, advance: Invoice) {
  const row = await db
    .from('invoices as a')
    .where('a.id', advance.id)
    .select(
      db.raw(`${ADVANCE_DEDUCTED_SQL('a')} AS deducted`),
      db.raw(`${ADVANCE_TAKEN_BACK_SQL('a')} AS taken`)
    )
    .firstOrFail()
  const entries = await Invoices.advancesOf(undefined, advance.jobId!)
  const entry = entries.find((candidate) => candidate.advance.id === advance.id)!
  assert.equal(Number(row.deducted), Number(entry.deducted))
  assert.equal(Number(row.taken), Number(entry.deducted) + Number(entry.credited))
  const state = advanceState(advance.total!, entry.deducted, entry.credited)
  // Fully taken back in SQL exactly when advanceState() says so
  assert.equal(state === 'fully_deducted', Number(row.taken) >= Number(advance.total))
  return { ...entry, state }
}

async function advanceStateOf(assert: Assert, advance: Invoice) {
  const { state } = await advanceOf(assert, advance)
  return state
}

/**
 * The draft's own lines (not its deductions), as the page sends them back.
 */
async function workLines(invoice: Invoice) {
  const lines = await linesOf(invoice)
  return lines
    .filter((line) => !line.deductsInvoiceId)
    .map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatCodeId: line.vatCodeId,
    }))
}

test.group('Credit Notes credit Advance Invoices', () => {
  test('an advance is credited for what is left of it, which then counts as taken back', async ({
    client,
    assert,
  }) => {
    const { office, job } = await setup()
    // 100 + 22% = 122.00
    const advance = await issuedAdvance(job, '100')
    assert.equal(await advanceStateOf(assert, advance), 'not_deducted')

    // An Invoice takes back 61.00 of it
    const draft = await Invoices.fromJob(job)
    await Invoices.save(draft, {
      lines: await workLines(draft),
      deductions: [{ advanceId: advance.id, amount: '61' }],
    })
    await Invoices.finalise(draft)

    // The Credit Note starts with what is left: 50 + 22%
    const note = await Invoices.createCreditNote(advance)
    const [line] = await linesOf(note)
    assert.equal(line.lineTotal, '50.00')
    const [advanceLine] = await linesOf(advance)
    // Never more than is left
    const above = await put(client, note, office, {
      lines: [{ ...creditLines([[advanceLine, '50.01']])[0], id: line.id }],
    })
    above.assertFlashMessage('error', it('flash.invoiceNotFinalisable.creditTooLarge'))
    const edit = await client.get(`/invoices/${note.id}/edit`).withInertia().loginAs(office)
    edit.assertInertiaPropsContains({ invoice: { credits: { left: '61.00' } } })

    // Part of it: partly taken back, in TS and SQL
    await Invoices.save(note, {
      lines: [{ ...creditLines([[advanceLine, '20']])[0], id: line.id }],
    })
    await Invoices.finalise(note)
    let state = await advanceOf(assert, advance)
    assert.equal(state.state, 'partly_deducted')
    assert.equal(state.credited, '24.40')
    assert.equal(state.left, '36.60')
    assert.isTrue(await billingOpen(job))
    // A later Invoice can't take back more than is now left
    const charge = await Charges.add(
      job,
      { description: 'Extra', quantity: '1', unit: null, unitPrice: '100', vatKind: 'labour' },
      office
    )
    const later = await Invoices.fromJob(job)
    await refused(
      assert,
      () =>
        Invoices.save(later, {
          lines: [],
          deductions: [{ advanceId: advance.id, amount: '36.61' }],
        }),
      'deductionTooLarge'
    )
    await Invoices.destroy(later)
    await Charges.setBillable(charge, false, office)

    // The rest credited: fully taken back, nothing left to credit
    const rest = await Invoices.createCreditNote(advance)
    const [restLine] = await linesOf(rest)
    assert.equal(restLine.lineTotal, '30.00')
    await Invoices.finalise(rest)
    state = await advanceOf(assert, advance)
    assert.equal(state.state, 'fully_deducted')
    assert.equal(state.left, '0.00')
    assert.isFalse(await billingOpen(job))
    assert.equal(await leftToClose(job, 'advances'), 0)
    const page = await client.get(`/invoices/${advance.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canCredit: false })
    const refusedNote = await post(client, `/invoices/${advance.id}/credit-notes`, office)
    refusedNote.assertFlashMessage('error', it('flash.creditNoteRefused.advanceTakenBack'))
  })

  test("crediting a final Invoice gives its deductions back, within the Invoice's total", async ({
    client,
    assert,
  }) => {
    const { office, job, hours, pipe, valve } = await setup()
    // 100 + 22%, taken back in full by the final Invoice of 180 of work
    const advance = await issuedAdvance(job, '100')
    const final = await invoiced(job)
    assert.equal(final.total, '97.60')
    assert.equal(await advanceStateOf(assert, advance), 'fully_deducted')
    // Fully deducted: nothing left to credit on the advance
    const nothing = await post(client, `/invoices/${advance.id}/credit-notes`, office)
    nothing.assertFlashMessage('error', it('flash.creditNoteRefused.advanceTakenBack'))

    // The prefill credits the work and gives the deduction back: the
    // Invoice's total, not more
    const note = await Invoices.createCreditNote(final)
    const prefilled = await linesOf(note)
    const deduction = prefilled.find((line) => line.deductsInvoiceId === advance.id)!
    assert.equal(deduction.lineTotal, '-100.00')
    const saved = await put(client, note, office, {
      lines: prefilled.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatCodeId: line.vatCodeId,
        ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
      })),
    })
    saved.assertFlashMessage('success', it('flash.invoiceSaved'))
    await note.refresh()
    assert.equal(await draftTotal(note), '97.60')

    // A deduction line is given back as it was: its price can't be changed
    const changed = await put(client, note, office, {
      lines: prefilled.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.deductsInvoiceId ? '-1' : line.unitPrice,
        vatCodeId: line.vatCodeId,
      })),
    })
    changed.assertFlashMessage('success', it('flash.invoiceSaved'))
    const after = await linesOf(note)
    const kept = after.find((line) => line.deductsInvoiceId === advance.id)!
    assert.equal(kept.lineTotal, '-100.00')

    // Removing it leaves the advance taken back, so less work is credited
    const withoutDeduction = await put(client, note, office, {
      lines: prefilled
        .filter((line) => !line.deductsInvoiceId)
        .map((line) => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatCodeId: line.vatCodeId,
        })),
    })
    withoutDeduction.assertFlashMessage('error', it('flash.invoiceNotFinalisable.creditTooLarge'))
    // With the deduction kept, the credited work must cover it
    const tooLittle = await put(client, note, office, {
      lines: [
        ...creditLines([[await lineOf(final, pipe), '10']]),
        {
          ...creditLines([[await InvoiceLine.findOrFail(deduction.creditsLineId!), '-100']])[0],
          id: deduction.id,
        },
      ],
    })
    tooLittle.assertFlashMessage('error', it('flash.invoiceNotFinalisable.negativeTotal'))

    // Finalised whole: the work's Charges are credited, and the advance
    // is no longer taken back, so it can be credited in turn
    const finalised = await post(client, `/invoices/${note.id}/finalise`, office)
    await note.refresh()
    finalised.assertFlashMessage(
      'success',
      it('flash.creditNoteFinalised', { number: note.formattedNumber })
    )
    for (const charge of [hours, pipe, valve]) {
      assert.equal(await bothStates(assert, charge), 'credited')
    }
    const state = await advanceOf(assert, advance)
    assert.equal(state.state, 'not_deducted')
    assert.equal(state.left, '122.00')
    assert.isTrue(await billingOpen(job))
    const advanceNote = await Invoices.createCreditNote(advance)
    await Invoices.finalise(advanceNote)
    assert.equal(await advanceStateOf(assert, advance), 'fully_deducted')
    assert.isFalse(await billingOpen(job))
  })

  test('a deduction over several VAT rows is given back whole or not at all', async ({
    client,
    assert,
  }) => {
    const { office, job } = await setup()
    // An advance at 22% and 10%
    const advance = await Invoices.createAdvance(job)
    const [line] = await linesOf(advance)
    const reduced = await vatCode('10%')
    await Invoices.save(advance, {
      lines: [
        {
          id: line.id,
          description: 'Acconto',
          quantity: '1',
          unitPrice: '50',
          vatCodeId: line.vatCodeId,
        },
        { description: 'Acconto', quantity: '1', unitPrice: '50', vatCodeId: reduced.id },
      ],
    })
    await Invoices.finalise(advance)
    await sentTo(advance, 'delivered')
    const final = await invoiced(job)

    const note = await Invoices.createCreditNote(final)
    const prefilled = await linesOf(note)
    const deductions = prefilled.filter((candidate) => candidate.deductsInvoiceId === advance.id)
    assert.lengthOf(deductions, 2)
    const lineInput = (candidate: InvoiceLine) => ({
      id: candidate.id,
      description: candidate.description,
      quantity: candidate.quantity,
      unitPrice: candidate.unitPrice,
      vatCodeId: candidate.vatCodeId,
    })
    const partial = await put(client, note, office, {
      lines: prefilled.filter((candidate) => candidate.id !== deductions[1].id).map(lineInput),
    })
    partial.assertFlashMessage('error', it('flash.invoiceNotFinalisable.partialDeduction'))
    const whole = await put(client, note, office, { lines: prefilled.map(lineInput) })
    whole.assertFlashMessage('success', it('flash.invoiceSaved'))
    await note.refresh()
    await final.refresh()
    assert.equal(await draftTotal(note), final.total)
    await Invoices.finalise(note)
    assert.equal(await advanceStateOf(assert, advance), 'not_deducted')
  })
})

test.group('Credit Notes on the Job page', () => {
  test('each Invoice lists its Credit Notes; invoiced so far and what is left count them', async ({
    client,
    assert,
  }) => {
    const { office, job, pipe } = await setup()
    const invoice = await invoiced(job)
    const page = async () => client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    const before = await page()
    before.assertInertiaPropsContains({
      invoicedSoFar: { amount: '180.00', of: '180.00' },
      leftToClose: { drafts: 0 },
    })

    // A draft is listed and left to close, but credits nothing yet
    const note = await creditNote(invoice, [[await lineOf(invoice, pipe), '20']])
    const draft = await page()
    draft.assertInertiaPropsContains({
      invoices: [
        {
          id: invoice.id,
          creditNotes: [{ id: note.id, number: null, status: 'draft', total: '24.40' }],
        },
      ],
      invoicedSoFar: { amount: '180.00', of: '180.00' },
      leftToClose: { drafts: 1 },
    })
    assert.equal(await leftToClose(job, 'drafts'), 1)

    // Finalised, it lowers what is invoiced so far
    await Invoices.finalise(note)
    await note.refresh()
    const issued = await page()
    issued.assertInertiaPropsContains({
      invoices: [
        {
          id: invoice.id,
          creditNotes: [{ id: note.id, number: note.formattedNumber, status: 'finalised' }],
        },
      ],
      invoicedSoFar: { amount: '160.00', of: '180.00' },
      leftToClose: { drafts: 0 },
    })

    // Credited in full, the pipe's work no longer counts as billable
    await Invoices.finalise(await creditNote(invoice, [[await lineOf(invoice, pipe), '40']]))
    const full = await page()
    full.assertInertiaPropsContains({ invoicedSoFar: { amount: '120.00', of: '120.00' } })
  })
})
