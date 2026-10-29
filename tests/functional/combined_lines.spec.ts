import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import InstalledEquipment from '#models/installed_equipment'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import type Job from '#models/job'
import LabourRate from '#models/labour_rate'
import type User from '#models/user'
import Visit from '#models/visit'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'
import { CHARGE_DESCRIPTION_MAX } from '#shared/charges'
import { sumAmounts } from '#shared/money'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { markDone, stateOf } from '#tests/helpers/charges'
import { it } from '#tests/helpers/i18n'

/**
 * A Job (a sale) with three closed Visits and a call-out on the Job
 * itself. On 05/10 and 12/10, Anna works 2 hours and Bruno 1 at 40, and a
 * valve (Groupable) is used, 3 then 2; on 05/10 a boiler (Equipment) is
 * installed, serial AB123. On 19/10, after the rate went up to 45, Anna
 * works 1 hour and a second boiler is installed, serial CD456.
 */
async function longJob() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician', { fullName: 'Anna' })
  const bruno = await createUser('technician', { fullName: 'Bruno' })
  const site = await createSite()
  const job = await createJob(await createCustomer(), {
    status: 'in_progress',
    siteId: site.id,
    workCategory: 'sale',
  })
  const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
  const valve = await createItem({ description: 'Valvola', resalePrice: '7.5' })
  const boiler = await createItem({
    description: 'Caldaia',
    resalePrice: '1200',
    maintenanceIntervalMonths: 12,
  })
  const visit = async (day: string) => {
    const start = DateTime.fromISO(`${day}T09:00`)
    const created = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 3 }),
      status: 'planned',
    })
    await created.related('technicians').attach([anna.id, bruno.id])
    return created
  }
  const hours = (on: Visit, user: User, amount: string) =>
    FieldWork.recordHours(on, { technicianId: user.id, labourRateId: rate.id, hours: amount })

  const first = await visit('2026-10-05')
  await hours(first, anna, '2')
  await hours(first, bruno, '1')
  await FieldWork.recordItem(first, { itemId: valve.id, quantity: '3' })
  await FieldWork.recordItem(first, { itemId: boiler.id, quantity: '1', serialNumber: 'AB123' })
  await FieldWork.setStatus(first, 'done', anna)

  const second = await visit('2026-10-12')
  await hours(second, anna, '2')
  await hours(second, bruno, '1')
  await FieldWork.recordItem(second, { itemId: valve.id, quantity: '2' })
  await FieldWork.setStatus(second, 'done', anna)

  rate.hourlyPrice = '45'
  await rate.save()
  const third = await visit('2026-10-19')
  await hours(third, anna, '1')
  await FieldWork.recordItem(third, { itemId: boiler.id, quantity: '1', serialNumber: 'CD456' })
  await FieldWork.setStatus(third, 'done', anna)

  const callOut = await Charges.add(
    job,
    { description: 'Uscita', quantity: '1', unit: null, unitPrice: '30', vatKind: 'labour' },
    office
  )
  return { office, job, valve, boiler, third, callOut }
}

async function linesOf(invoice: Invoice) {
  return InvoiceLine.query().where('invoiceId', invoice.id).preload('charges').orderBy('position')
}

function draft(client: ApiClient, job: Job, office: User, form: Record<string, string>) {
  return client
    .post(`/jobs/${job.id}/invoices`)
    .form(form)
    .withCsrfToken()
    .loginAs(office)
    .redirects(0)
}

async function draftOf(job: Job) {
  return Invoice.query().where('jobId', job.id).where('status', 'draft').firstOrFail()
}

test.group('Combining alike Charges on drafts', () => {
  test('alike hours and Groupable Items share a line; Equipment and other costs get their own', async ({
    client,
    assert,
  }) => {
    const { office, job, valve, boiler } = await longJob()
    const response = await draft(client, job, office, { combine: 'true' })
    response.assertFlashMessage('success', it('flash.invoiceCreated'))

    const lines = await linesOf(await draftOf(job))
    assert.deepEqual(
      lines.map((line) => [
        line.description,
        line.quantity,
        line.unit,
        line.unitPrice,
        line.lineTotal,
        line.itemId,
        line.charges.length,
      ]),
      [
        // Same rate and price over two Visits; the new price on a line of its own
        [
          it('documents.invoice.combinedLine', {
            name: 'Idraulico',
            visits: 2,
            from: '05/10',
            to: '12/10',
          }),
          '6.000',
          'h',
          '40.0000',
          '240.00',
          null,
          4,
        ],
        ['Idraulico – Anna (19/10)', '1.000', 'h', '45.0000', '45.00', null, 1],
        [
          it('documents.invoice.combinedLine', {
            name: 'Valvola',
            visits: 2,
            from: '05/10',
            to: '12/10',
          }),
          '5.000',
          'pz',
          '7.5000',
          '37.50',
          valve.id,
          2,
        ],
        // Each boiler on its own line, next to each other, named by its serial
        ['Caldaia (05/10) — matr. AB123', '1.000', 'pz', '1200.0000', '1200.00', boiler.id, 1],
        ['Caldaia (19/10) — matr. CD456', '1.000', 'pz', '1200.0000', '1200.00', boiler.id, 1],
        ['Uscita', '1.000', null, '30.0000', '30.00', null, 1],
      ]
    )
  })

  test('one line per Charge when not combining, as before', async ({ client, assert }) => {
    const { office, job } = await longJob()
    await draft(client, job, office, { combine: 'false', organiseBy: 'none' })

    const lines = await linesOf(await draftOf(job))
    assert.lengthOf(lines, 10)
    assert.isTrue(lines.every((line) => line.charges.length === 1))
    assert.deepEqual(
      lines.slice(0, 4).map((line) => line.description),
      [
        'Idraulico – Anna (05/10)',
        'Idraulico – Bruno (05/10)',
        'Valvola (05/10)',
        'Caldaia (05/10) — matr. AB123',
      ]
    )
  })

  test('"up to" a day bills only the Visits until then, and the Job\'s own Charges', async ({
    client,
    assert,
  }) => {
    const { office, job, third, callOut } = await longJob()
    // An issued advance: a draft leaving work out takes none of it back
    const advance = await Invoices.createAdvance(job)
    await advance.load('lines')
    await Invoices.save(advance, {
      lines: [
        {
          description: 'Acconto',
          quantity: '1',
          unitPrice: '100',
          vatCodeId: advance.lines[0].vatCodeId,
        },
      ],
    })
    await Invoices.finalise(advance)
    await draft(client, job, office, { combine: 'true', upTo: '2026-10-12' })

    const invoice = await draftOf(job)
    const lines = await linesOf(invoice)
    assert.deepEqual(
      lines.map((line) => line.charges.length),
      [4, 2, 1, 1]
    )
    assert.equal(lines[3].charges[0].id, callOut.id)
    assert.lengthOf(await db.from('advance_deductions').where('invoice_id', invoice.id), 0)
    // The last Visit's work waits for the next Invoice
    await third.load('charges')
    for (const charge of third.charges) assert.equal(await stateOf(charge), 'to_bill')

    // Nothing up to a day before any Visit but the call-out
    await Invoices.destroy(invoice)
    await draft(client, job, office, { combine: 'true', upTo: '2026-10-01' })
    const early = await linesOf(await draftOf(job))
    assert.deepEqual(
      early.map((line) => line.description),
      ['Uscita']
    )

    // Up to the last Visit, everything: the advance is taken back
    await Invoices.destroy(await draftOf(job))
    await draft(client, job, office, { combine: 'true', upTo: '2026-10-19' })
    const all = await draftOf(job)
    // Its six lines and the deduction's
    assert.lengthOf(await linesOf(all), 7)
    const taken = await db.from('advance_deductions').where('invoice_id', all.id)
    assert.deepEqual(
      taken.map((row) => row.advance_id),
      [advance.id]
    )
  })

  test('"up to" must be a date', async ({ client, assert }) => {
    const { office, job } = await longJob()
    const response = await draft(client, job, office, { combine: 'true', upTo: 'domani' })
    assert.deepEqual(response.flashMessage('inputErrorsBag'), {
      upTo: [it('validator.shared.messages.date', { field: 'fino al' })],
    })
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 0)
  })

  test('a combined line bills exactly its Charges, and is credited as one line', async ({
    assert,
  }) => {
    const { job } = await longJob()
    const invoice = await Invoices.fromJob(job)
    await Invoices.finalise(invoice)
    await invoice.refresh()
    const lines = await linesOf(invoice)
    const [hoursLine, , valveLine] = lines

    // Each Charge's billed part of its line adds up to the line
    for (const line of lines) {
      const billed = await db
        .from('charge_events')
        .where('invoice_line_id', line.id)
        .where('kind', 'billed')
        .select('amount')
      assert.equal(sumAmounts(billed.map((row) => row.amount)), line.lineTotal)
      assert.lengthOf(billed, line.charges.length)
    }

    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'delivered' })
    // The hours in full, part of the valves
    const note = await Invoices.createCreditNote(invoice)
    await Invoices.save(note, {
      lines: [
        [hoursLine, '240'],
        [valveLine, '10'],
      ].map(([line, unitPrice]) => ({
        creditsLineId: (line as InvoiceLine).id,
        description: (line as InvoiceLine).description,
        quantity: '1',
        unitPrice: unitPrice as string,
        vatCodeId: (line as InvoiceLine).vatCodeId,
      })),
    })
    await Invoices.finalise(note)

    for (const charge of hoursLine.charges) assert.equal(await stateOf(charge), 'credited')
    for (const charge of valveLine.charges) assert.equal(await stateOf(charge), 'billed')
  })

  test("Charges on the Job itself combine with the Visits' alike ones", async ({
    client,
    assert,
  }) => {
    const { office, job, valve } = await longJob()
    // Valves Office added on the Job itself, at the same price
    const onJob = await Charge.create({
      jobId: job.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '4',
      billQuantity: '4',
      unitPrice: '7.5',
      description: 'Valvola',
    })
    await markDone(onJob)
    await draft(client, job, office, { combine: 'true' })

    const drafted = await linesOf(await draftOf(job))
    const line = drafted.find((l) => l.itemId === valve.id)!
    // The period counts the Visits only
    assert.equal(
      line.description,
      it('documents.invoice.combinedLine', {
        name: 'Valvola',
        visits: 2,
        from: '05/10',
        to: '12/10',
      })
    )
    assert.equal(line.quantity, '9.000')
    assert.equal(line.lineTotal, '67.50')
    assert.include(
      line.charges.map((charge) => charge.id),
      onJob.id
    )
  })

  test('many long serial numbers are cut short, never the draft', async ({ client, assert }) => {
    const { office, job, boiler } = await longJob()
    const [first] = await Charge.query().where('itemId', boiler.id).orderBy('id')
    // A description as long as a Charge's can be, and 40 long serials
    await Charge.query()
      .where('id', first.id)
      .update({ description: 'C'.repeat(CHARGE_DESCRIPTION_MAX) })
    const [unit] = await InstalledEquipment.query().where('chargeId', first.id)
    for (let n = 0; n < 40; n++) {
      await InstalledEquipment.create({
        siteId: unit.siteId,
        itemId: boiler.id,
        chargeId: first.id,
        serialNumber: `SN-${n}-${'X'.repeat(40)}`,
        equipmentType: unit.equipmentType,
        installedOn: unit.installedOn,
      })
    }
    const response = await draft(client, job, office, { combine: 'true' })
    response.assertFlashMessage('success', it('flash.invoiceCreated'))

    const drafted = await linesOf(await draftOf(job))
    const line = drafted.find((l) => l.charges.some((charge) => charge.id === first.id))!
    assert.isAtMost(line.description.length, CHARGE_DESCRIPTION_MAX)
    assert.match(line.description, /^C+ \(05\/10\) — matr\. AB123, SN-0-X+, .*, …$/)
  })

  test('without equipment at a Site, the serial number recorded on the Charge', async ({
    client,
    assert,
  }) => {
    const { office, job, boiler } = await longJob()
    // As on a Job without a Site, which installs nothing
    await InstalledEquipment.query().where('itemId', boiler.id).delete()
    await draft(client, job, office, { combine: 'true' })

    const lines = await linesOf(await draftOf(job))
    assert.deepEqual(
      lines.filter((line) => line.itemId === boiler.id).map((line) => line.description),
      ['Caldaia (05/10) — matr. AB123', 'Caldaia (19/10) — matr. CD456']
    )
  })

  test('a folded draft, saved as the page sends it, bills every Charge on its lump line', async ({
    client,
    assert,
  }) => {
    const { office, job, valve } = await longJob()
    const pipe = await createItem({ description: 'Tubo', resalePrice: '3' })
    const onJob = await Charge.create({
      jobId: job.id,
      kind: 'item',
      itemId: pipe.id,
      quantity: '2',
      billQuantity: '2',
      unitPrice: '3',
      description: 'Tubo',
    })
    await markDone(onJob)
    await draft(client, job, office, { combine: 'true' })
    const invoice = await draftOf(job)
    const lines = await linesOf(invoice)
    const consumables = lines.filter((line) => [valve.id, pipe.id].includes(line.itemId!))
    assert.lengthOf(consumables, 2)

    // "Fold consumables": the first becomes the lump, the other goes
    const [lump] = consumables
    const body = {
      lines: lines
        .filter((line) => line.id !== consumables[1].id)
        .map((line) =>
          line.id === lump.id
            ? {
                id: line.id,
                description: it('documents.invoice.consumablesLine'),
                quantity: '1',
                unitPrice: '43,50',
                vatCodeId: line.vatCodeId,
                chargeIds: consumables.flatMap((c) => c.charges.map((charge) => charge.id)),
              }
            : {
                id: line.id,
                ...(line.itemId && { itemId: line.itemId }),
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                vatCodeId: line.vatCodeId,
                chargeIds: line.charges.map((charge) => charge.id),
              }
        ),
    }
    const saved = await client
      .put(`/invoices/${invoice.id}`)
      .json(body)
      .header('referer', `/invoices/${invoice.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    saved.assertFlashMessage('success', it('flash.invoiceSaved'))

    const after = await linesOf(invoice)
    const folded = after.find((line) => line.id === lump.id)!
    assert.deepEqual(
      [folded.description, folded.itemId, folded.quantity, folded.lineTotal, folded.charges.length],
      [it('documents.invoice.consumablesLine'), null, '1.000', '43.50', 3]
    )
    assert.lengthOf(after, lines.length - 1)

    // Finalised, each folded Charge is billed its share of the lump
    await completeCompany()
    await Invoices.finalise(invoice)
    const billed = await db
      .from('charge_events')
      .where('invoice_line_id', lump.id)
      .where('kind', 'billed')
      .orderBy('charge_id')
      .select('charge_id', 'amount')
    assert.deepEqual(
      billed.map((row) => row.amount),
      ['22.50', '15.00', '6.00']
    )
  })
})
