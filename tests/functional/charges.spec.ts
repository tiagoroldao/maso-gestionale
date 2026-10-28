import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import InstalledEquipment from '#models/installed_equipment'
import Invoice from '#models/invoice'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Charges from '#services/charges'
import Jobs from '#services/jobs'
import VatDefaults from '#services/vat_defaults'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * A Time & Materials Job with an open Visit: Anna's hours and a valve.
 */
async function setup() {
  const anna = await createUser('technician', { fullName: 'Anna' })
  const office = await createUser('office')
  const job = await createJob(await createCustomer(), {
    kind: 'time_and_materials',
    status: 'in_progress',
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
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })
  const hours = await FieldWork.recordHours(
    visit,
    { technicianId: anna.id, labourRateId: rate.id, hours: '2' },
    anna
  )
  const line = await FieldWork.recordItem(visit, { itemId: valve.id, quantity: '3' }, anna)
  return { anna, office, job, visit, rate, valve, hours, line }
}

async function history(charge: Charge) {
  const events = await ChargeEvent.query().where('chargeId', charge.id).orderBy('id')
  return events.map((event) => event.kind)
}

test.group('Charges', () => {
  test('Technicians record hours and Items as Charges, priced when recorded', async ({
    client,
    assert,
  }) => {
    const { anna, visit, hours, line } = await setup()
    await hours.refresh()
    await line.refresh()

    assert.equal(hours.kind, 'labour')
    assert.equal(hours.unitPrice, '40.0000')
    assert.equal(hours.billQuantity, '2.000')
    assert.equal(hours.description, 'Idraulico – Anna')
    assert.equal(line.unitPrice, '7.5000')
    assert.equal(line.description, 'Valvola')
    assert.deepEqual(await history(hours), ['recorded'])
    const recorded = await ChargeEvent.findByOrFail('chargeId', hours.id)
    assert.equal(recorded.userId, anna.id)

    // Someone outside the app, named instead
    await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({
        workerName: 'Marco (ditta Rossi)',
        labourRateId: String(hours.labourRateId),
        hours: '8',
      })
      .withCsrfToken()
      .loginAs(anna)
    const contractor = await Charge.query().whereNotNull('workerName').firstOrFail()
    assert.isNull(contractor.userId)
    assert.equal(contractor.description, 'Idraulico – Marco (ditta Rossi)')

    // The Technician's page lists them without prices
    const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    const props = JSON.stringify(page.inertiaProps)
    assert.include(props, 'Marco (ditta Rossi)')
    assert.notInclude(props, 'unitPrice')
    assert.notInclude(props, '40.0000')
  })

  test('hours need a Technician or a name', async ({ client, assert }) => {
    const { anna, visit, rate } = await setup()

    const response = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ labourRateId: String(rate.id), hours: '1' })
      .header('referer', `/my-visits/${visit.id}`)
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['workerName'])
    assert.lengthOf(await Charge.query().where('kind', 'labour'), 1)
  })

  test('a correction is recorded, and what is billed follows until Office edits it', async ({
    client,
    assert,
  }) => {
    const { office, hours } = await setup()
    const senior = await LabourRate.create({ name: 'Capo squadra', hourlyPrice: '55' })

    await client
      .put(`/charges/${hours.id}/recorded`)
      .form({ labourRateId: String(senior.id), workerName: 'Marco', quantity: '3' })
      .withCsrfToken()
      .loginAs(office)

    await hours.refresh()
    assert.equal(hours.labourRateId, senior.id)
    assert.isNull(hours.userId)
    assert.equal(hours.workerName, 'Marco')
    assert.equal(hours.quantity, '3.000')
    assert.equal(hours.billQuantity, '3.000')
    assert.equal(hours.unitPrice, '55.0000')
    assert.equal(hours.description, 'Capo squadra – Marco')
    const corrected = await ChargeEvent.query()
      .where('chargeId', hours.id)
      .where('kind', 'corrected')
      .firstOrFail()
    assert.equal(corrected.userId, office.id)
    assert.deepEqual(corrected.changes, {
      before: { quantity: '2.000', labourRate: 'Idraulico', worker: 'Anna' },
      after: { quantity: '3.000', labourRate: 'Capo squadra', worker: 'Marco' },
    })

    // Office sets what is billed; later corrections leave it alone
    await client
      .put(`/charges/${hours.id}/billing`)
      .form({ quantity: '2,5', unitPrice: '50', description: 'Manodopera' })
      .withCsrfToken()
      .loginAs(office)
    await client
      .put(`/charges/${hours.id}/recorded`)
      .form({ labourRateId: String(senior.id), workerName: 'Marco', quantity: '4' })
      .withCsrfToken()
      .loginAs(office)

    await hours.refresh()
    assert.equal(hours.quantity, '4.000')
    assert.equal(hours.billQuantity, '2.500')
    assert.equal(hours.unitPrice, '50.0000')
    assert.equal(hours.description, 'Manodopera')
    assert.deepEqual(await history(hours), ['recorded', 'corrected', 'billing_edited', 'corrected'])

    // Saving unchanged values adds nothing to the history
    await client
      .put(`/charges/${hours.id}/billing`)
      .form({ quantity: '2,5', unitPrice: '50,00', description: 'Manodopera' })
      .withCsrfToken()
      .loginAs(office)
    assert.lengthOf(await history(hours), 4)

    const page = await client.get(`/charges/${hours.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ charge: { state: 'to_bill' } })
  })

  test('hours go only to an active Technician on the Visit, unless already theirs', async ({
    client,
    assert,
  }) => {
    const { anna, office, rate, hours } = await setup()
    const outsider = await createUser('technician')
    const retired = await createUser('technician', { isActive: false })
    const visit = await Visit.findOrFail(hours.visitId)
    await visit.related('technicians').attach([retired.id])
    const correct = (technicianId: number) =>
      client
        .put(`/charges/${hours.id}/recorded`)
        .form({ labourRateId: String(rate.id), technicianId: String(technicianId), quantity: '1' })
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)

    for (const user of [outsider, retired, office]) {
      const refused = await correct(user.id)
      refused.assertFlashMessage('error', it('flash.chargeRefused.worker'))
    }
    await hours.refresh()
    assert.equal(hours.userId, anna.id)
    assert.equal(hours.quantity, '2.000')

    // Anna keeps her hours even once deactivated
    anna.isActive = false
    await anna.save()
    const kept = await correct(anna.id)
    kept.assertFlashMessage('success', it('flash.chargeCorrected'))
  })

  test("a cancelled Job's Charges can be corrected, but their billing is frozen", async ({
    client,
    assert,
  }) => {
    const { office, job, rate, hours } = await setup()
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)

    for (const request of [
      client
        .put(`/charges/${hours.id}/billing`)
        .form({ quantity: '1', unitPrice: '1', description: 'x' }),
      client.post(`/charges/${hours.id}/not-billable`),
    ]) {
      const refused = await request.withCsrfToken().loginAs(office).redirects(0)
      refused.assertFlashMessage('error', it('flash.chargeRefused.cancelled'))
    }
    assert.deepEqual(await history(hours), ['recorded'])

    const corrected = await client
      .put(`/charges/${hours.id}/recorded`)
      .form({ labourRateId: String(rate.id), workerName: 'Marco', quantity: '1' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    corrected.assertFlashMessage('success', it('flash.chargeCorrected'))
    await hours.refresh()
    assert.equal(hours.quantity, '1.000')
    assert.equal(hours.billQuantity, '2.000')
    assert.equal(hours.description, 'Idraulico – Anna')
  })

  test('correcting an Item off stock moves stock by the difference', async ({ client, assert }) => {
    const { anna, office, job, visit, valve, line } = await setup()
    const tap = await createItem({ description: 'Rubinetto', unit: 'pz', resalePrice: '20' })
    await StockLedger.receive(valve, { quantity: '10', occurredOn: DateTime.now() })
    await FieldWork.setStatus(visit, 'done', anna)
    assert.equal(await StockLedger.levelOf(valve), '7.000')

    await client
      .put(`/charges/${line.id}/recorded`)
      .form({ itemId: String(valve.id), quantity: '2' })
      .withCsrfToken()
      .loginAs(office)
    assert.equal(await StockLedger.levelOf(valve), '8.000')
    const adjustment = await StockMovement.query()
      .where('kind', 'adjustment')
      .where('itemId', valve.id)
      .firstOrFail()
    assert.equal(adjustment.quantity, '1.000')
    assert.equal(adjustment.reference, job.number)
    assert.equal(adjustment.createdBy, office.id)

    // Another Item: the old one goes back, the new one is used
    await client
      .put(`/charges/${line.id}/recorded`)
      .form({ itemId: String(tap.id), quantity: '1' })
      .withCsrfToken()
      .loginAs(office)
    assert.equal(await StockLedger.levelOf(valve), '10.000')
    assert.equal(await StockLedger.levelOf(tap), '-1.000')
    await line.refresh()
    assert.equal(line.itemId, tap.id)
    assert.equal(line.unitPrice, '20.0000')
    assert.equal(line.description, 'Rubinetto')
    // The usage itself is never rewritten
    const usage = await StockMovement.findOrFail(line.stockMovementId)
    assert.equal(usage.quantity, '-3.000')
  })

  test('an Item corrected on an open Visit leaves stock with the corrected quantity', async ({
    client,
    assert,
  }) => {
    const { anna, office, visit, valve, line } = await setup()

    await client
      .put(`/charges/${line.id}/recorded`)
      .form({ itemId: String(valve.id), quantity: '5' })
      .withCsrfToken()
      .loginAs(office)
    const corrected = await ChargeEvent.query()
      .where('chargeId', line.id)
      .where('kind', 'corrected')
      .firstOrFail()
    assert.deepEqual(corrected.changes, {
      before: { quantity: '3.000' },
      after: { quantity: '5.000' },
    })

    await FieldWork.setStatus(visit, 'done', anna)
    assert.equal(await StockLedger.levelOf(valve), '-5.000')
    assert.lengthOf(await StockMovement.query().where('kind', 'adjustment'), 0)
  })

  test('an archived Labour Rate or Item can only stay, not be picked', async ({
    client,
    assert,
  }) => {
    const { office, hours, rate } = await setup()
    const old = await LabourRate.create({ name: 'Vecchia', hourlyPrice: '30' })
    old.archivedAt = DateTime.now()
    await old.save()

    const refused = await client
      .put(`/charges/${hours.id}/recorded`)
      .form({ labourRateId: String(old.id), technicianId: String(hours.userId), quantity: '2' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.chargeRefused.archived'))
    await hours.refresh()
    assert.equal(hours.labourRateId, rate.id)

    // The rate already on the Charge can be kept once archived
    rate.archivedAt = DateTime.now()
    await rate.save()
    const kept = await client
      .put(`/charges/${hours.id}/recorded`)
      .form({ labourRateId: String(rate.id), technicianId: String(hours.userId), quantity: '1' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    kept.assertFlashMessage('success', it('flash.chargeCorrected'))
  })

  test('not billable Charges stay out of the draft and the totals, until billable again', async ({
    client,
    assert,
  }) => {
    const { anna, office, job, visit, hours, line } = await setup()
    await FieldWork.setStatus(visit, 'done', anna)

    await client.post(`/charges/${line.id}/not-billable`).withCsrfToken().loginAs(office)
    // Marking it again changes nothing
    await client.post(`/charges/${line.id}/not-billable`).withCsrfToken().loginAs(office)
    assert.deepEqual(await history(line), ['recorded', 'not_billable'])

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ timeAndMaterials: { total: '80.00', lines: 1 } })

    const invoice = await Invoices.fromTimeAndMaterials(job)
    await invoice.load('lines')
    assert.deepEqual(
      invoice.lines.map((l) => l.description),
      ['Idraulico – Anna (20/10)']
    )
    await line.refresh()
    assert.isNull(line.invoiceId)

    // Once an Invoice holds a Charge, billing changes only through billing
    for (const request of [
      client.post(`/charges/${hours.id}/not-billable`),
      client
        .put(`/charges/${hours.id}/billing`)
        .form({ quantity: '1', unitPrice: '1', description: 'x' }),
    ]) {
      const refused = await request.withCsrfToken().loginAs(office).redirects(0)
      refused.assertFlashMessage('error', it('flash.chargeRefused.billed'))
    }
    await hours.refresh()
    assert.equal(hours.description, 'Idraulico – Anna')

    // Billable again: the next draft takes it
    await Invoice.query().where('id', invoice.id).delete()
    await client.post(`/charges/${line.id}/billable`).withCsrfToken().loginAs(office)
    assert.deepEqual(await history(line), ['recorded', 'not_billable', 'billable'])
    const next = await Invoices.fromTimeAndMaterials(job)
    await next.load('lines')
    assert.lengthOf(next.lines, 2)
  })

  test('the billing-open rule in SQL ignores not billable Charges', async ({ client, assert }) => {
    const { anna, office, job, visit, hours, line } = await setup()
    await FieldWork.setStatus(visit, 'done', anna)
    const billingOpen = async () => {
      const state = await Job.query()
        .withScopes((scopes) => scopes.withBillingState())
        .where('id', job.id)
        .firstOrFail()
      return state.$extras.billing_open
    }

    assert.isTrue(await billingOpen())
    await client.post(`/charges/${hours.id}/not-billable`).withCsrfToken().loginAs(office)
    assert.isTrue(await billingOpen())
    await client.post(`/charges/${line.id}/not-billable`).withCsrfToken().loginAs(office)
    assert.isFalse(await billingOpen())
  })

  test("Technicians can't remove a Charge Office already reviewed", async ({ client, assert }) => {
    const { anna, office, visit, hours } = await setup()
    await client
      .put(`/charges/${hours.id}/billing`)
      .form({ quantity: '2', unitPrice: '35', description: 'Manodopera' })
      .withCsrfToken()
      .loginAs(office)

    const refused = await client
      .delete(`/charges/${hours.id}`)
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.fieldWorkRefused.reviewed'))
    await visit.load('hours')
    assert.lengthOf(visit.hours, 1)
  })

  test('the history can not be changed', async ({ assert }) => {
    const { hours } = await setup()
    const event = await ChargeEvent.findByOrFail('chargeId', hours.id)

    let message = 'allowed'
    try {
      // In a savepoint: the refused statement aborts its transaction
      await db.transaction((trx) =>
        trx.from('charge_events').where('id', event.id).update({ kind: 'billable' })
      )
    } catch (error) {
      message = (error as Error).message
    }
    assert.include(message, 'Charge history can not be changed')
  })

  test('only Admin and Office review Charges', async ({ client, assert }) => {
    const { hours } = await setup()
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      const page = await client.get(`/charges/${hours.id}/edit`).withInertia().loginAs(user)
      page.assertStatus(403)
      for (const request of [
        client.put(`/charges/${hours.id}/recorded`).form({ quantity: '9' }),
        client
          .put(`/charges/${hours.id}/billing`)
          .form({ quantity: '9', unitPrice: '1', description: 'x' }),
        client.post(`/charges/${hours.id}/not-billable`),
        client.post(`/charges/${hours.id}/billable`),
      ]) {
        const denied = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    await hours.refresh()
    assert.equal(hours.quantity, '2.000')
    assert.deepEqual(await history(hours), ['recorded'])

    const admin = await createUser('admin')
    const page = await client.get(`/charges/${hours.id}/edit`).withInertia().loginAs(admin)
    page.assertStatus(200)
  })
})

test.group('Charges on the Job itself', () => {
  test('Office adds a cost to the Job; the draft bills it with its VAT kind', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), {
      kind: 'time_and_materials',
      status: 'in_progress',
    })

    const response = await client
      .post(`/jobs/${job.id}/charges`)
      .form({
        description: 'Collaboratore esterno',
        quantity: '8',
        unit: 'h',
        unitPrice: '30',
        vatKind: 'material',
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.chargeAdded'))
    const charge = await Charge.findByOrFail('jobId', job.id)
    assert.equal(charge.kind, 'other')
    assert.isNull(charge.visitId)
    assert.equal(charge.billQuantity, '8.000')
    assert.equal(charge.unitPrice, '30.0000')
    assert.equal(charge.unit, 'h')
    assert.equal(charge.vatKind, 'material')
    const recorded = await ChargeEvent.findByOrFail('chargeId', charge.id)
    assert.equal(recorded.kind, 'recorded')
    assert.equal(recorded.userId, office.id)

    // Billable at once, without any Visit
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      canInvoice: true,
      timeAndMaterials: { total: '240.00', lines: 1 },
      charges: [{ id: charge.id, visitId: null, unit: 'h', state: 'to_bill' }],
    })

    const invoice = await Invoices.fromTimeAndMaterials(job)
    await invoice.load('lines')
    const [line] = invoice.lines
    assert.equal(line.description, 'Collaboratore esterno')
    assert.equal(line.unit, 'h')
    assert.equal(line.lineTotal, '240.00')
    await job.refresh()
    const defaults = await VatDefaults.forJob(job)
    assert.equal(line.vatCodeId, defaults.material.id)
    await charge.refresh()
    assert.equal(charge.invoiceId, invoice.id)
  })

  test('its quantity, billing, unit and VAT kind are reviewed like any Charge', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { kind: 'quoted', status: 'accepted' })
    const charge = await Charges.add(
      job,
      { description: 'Uscita', quantity: '1', unit: null, unitPrice: '35', vatKind: 'labour' },
      office
    )

    await client
      .put(`/charges/${charge.id}/recorded`)
      .form({ quantity: '2' })
      .withCsrfToken()
      .loginAs(office)
    await client
      .put(`/charges/${charge.id}/billing`)
      .form({
        quantity: '2',
        unitPrice: '30',
        description: 'Uscite',
        unit: 'n',
        vatKind: 'material',
      })
      .withCsrfToken()
      .loginAs(office)
    await client.post(`/charges/${charge.id}/not-billable`).withCsrfToken().loginAs(office)

    await charge.refresh()
    assert.equal(charge.quantity, '2.000')
    assert.equal(charge.billQuantity, '2.000')
    assert.equal(charge.unitPrice, '30.0000')
    assert.equal(charge.unit, 'n')
    assert.equal(charge.vatKind, 'material')
    assert.deepEqual(await history(charge), [
      'recorded',
      'corrected',
      'billing_edited',
      'not_billable',
    ])
    const edited = await ChargeEvent.query()
      .where('chargeId', charge.id)
      .where('kind', 'billing_edited')
      .firstOrFail()
    assert.deepEqual(edited.changes, {
      before: { unitPrice: '35.0000', description: 'Uscita', unit: null, vatKind: 'labour' },
      after: { unitPrice: '30.0000', description: 'Uscite', unit: 'n', vatKind: 'material' },
    })

    const page = await client.get(`/charges/${charge.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      charge: { kind: 'other', state: 'not_billable', billing: { vatKind: 'material' } },
    })
  })

  test('a cost needs a VAT kind, and a cancelled Job takes none', async ({ client, assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { kind: 'time_and_materials' })
    const cost = { description: 'Uscita', quantity: '1', unitPrice: '35' }

    const invalid = await client
      .post(`/jobs/${job.id}/charges`)
      .form(cost)
      .header('referer', `/jobs/${job.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(invalid.flashMessage('inputErrorsBag'), ['vatKind'])

    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)
    const refused = await client
      .post(`/jobs/${job.id}/charges`)
      .form({ ...cost, vatKind: 'labour' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.chargeRefused.cancelled'))
    assert.lengthOf(await Charge.all(), 0)
  })

  test("a Job's kind is fixed once it has a Charge", async ({ assert }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { kind: 'time_and_materials' })
    await job.refresh()
    const details = {
      customerId: job.customerId,
      kind: 'quoted' as const,
      workCategory: job.workCategory,
      title: job.title,
    }
    assert.isFalse(await Jobs.kindLocked(job))

    await Charges.add(
      job,
      { description: 'Uscita', quantity: '1', unit: null, unitPrice: '35', vatKind: 'labour' },
      office
    )
    assert.isTrue(await Jobs.kindLocked(job))
    await Jobs.update(job.id, details)
    await job.refresh()
    assert.equal(job.kind, 'time_and_materials')
  })

  test('a draft bills Visit Charges by day, then the Job ones; billed or not billable ones stop it', async ({
    client,
    assert,
  }) => {
    const { anna, office, job, visit, hours, line } = await setup()
    await FieldWork.setStatus(visit, 'done', anna)
    const callOut = await Charges.add(
      job,
      { description: 'Uscita', quantity: '1', unit: null, unitPrice: '35', vatKind: 'labour' },
      office
    )

    const invoice = await Invoices.fromTimeAndMaterials(job)
    await invoice.load('lines', (lines) => lines.orderBy('position'))
    assert.deepEqual(
      invoice.lines.map((l) => l.description),
      ['Idraulico – Anna (20/10)', 'Valvola (20/10)', 'Uscita']
    )

    // With everything held by the draft, or not billable, nothing is left
    await Invoice.query().where('id', invoice.id).delete()
    for (const charge of [hours, line, callOut]) {
      await Charges.setBillable(charge, false, office)
    }
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ canInvoice: false })
  })

  test('only Admin and Office add costs to a Job', async ({ client, assert }) => {
    const job = await createJob(await createCustomer(), { kind: 'time_and_materials' })
    const cost = { description: 'Uscita', quantity: '1', unitPrice: '35', vatKind: 'labour' }
    for (const role of ['technician', 'superuser'] as const) {
      const denied = await client
        .post(`/jobs/${job.id}/charges`)
        .form(cost)
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(await createUser(role))
        .redirects(0)
      denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await Charge.all(), 0)

    const added = await client
      .post(`/jobs/${job.id}/charges`)
      .form(cost)
      .withCsrfToken()
      .loginAs(await createUser('admin'))
      .redirects(0)
    added.assertFlashMessage('success', it('flash.chargeAdded'))
  })
})

test.group('Charges for installed Items', () => {
  test('changing the Item moves the equipment the Charge created', async ({ client, assert }) => {
    const { office, job, visit } = await setup()
    const site = await createSite()
    job.siteId = site.id
    await job.save()
    const boiler = await createItem({ description: 'Caldaia A', maintenanceIntervalMonths: 12 })
    const other = await createItem({ description: 'Caldaia B', maintenanceIntervalMonths: 24 })
    const charge = await FieldWork.recordItem(visit, {
      itemId: boiler.id,
      quantity: '1',
      installed: true,
    })

    const response = await client
      .put(`/charges/${charge.id}/recorded`)
      .form({ itemId: String(other.id), quantity: '1' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.chargeCorrected'))

    const equipment = await InstalledEquipment.findOrFail(charge.installedEquipmentId)
    assert.equal(equipment.itemId, other.id)
    assert.equal(equipment.maintenanceIntervalMonths, 24)
  })

  test('equipment already at the Site keeps its Item; the change is refused', async ({
    client,
    assert,
  }) => {
    const { office, job, visit } = await setup()
    const site = await createSite()
    job.siteId = site.id
    await job.save()
    const boiler = await createItem({ description: 'Caldaia A' })
    const other = await createItem({ description: 'Caldaia B' })
    const existing = await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia',
    })
    const charge = await FieldWork.recordItem(visit, {
      itemId: boiler.id,
      quantity: '1',
      installed: true,
      equipmentId: existing.id,
    })

    const refused = await client
      .put(`/charges/${charge.id}/recorded`)
      .form({ itemId: String(other.id), quantity: '1' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage('error', it('flash.chargeRefused.installed'))
    await existing.refresh()
    assert.equal(existing.itemId, boiler.id)
    await charge.refresh()
    assert.equal(charge.itemId, boiler.id)

    // The quantity alone can still be corrected
    const kept = await client
      .put(`/charges/${charge.id}/recorded`)
      .form({ itemId: String(boiler.id), quantity: '2' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    kept.assertFlashMessage('success', it('flash.chargeCorrected'))
  })
})
