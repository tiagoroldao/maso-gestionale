import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

test.group('Charges in the browser', () => {
  test('Office reviews a Charge from the Job page', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const anna = await createUser('technician', { fullName: 'Anna' })
    const job = await createJob(await createCustomer(), {
      status: 'in_progress',
    })
    const start = DateTime.now().minus({ days: 1 })
    const done = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })
    await done.related('technicians').attach([anna.id])
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const charge = await FieldWork.recordHours(done, {
      technicianId: anna.id,
      labourRateId: rate.id,
      hours: '2',
    })

    const page = await visit(`/jobs/${job.id}`)
    await page.getByTestId('charges').getByText('Idraulico – Anna').waitFor()
    await page.getByRole('link', { name: it('ui.charges.open') }).click()
    await page.waitForURL(/\/charges\/\d+\/edit$/)

    await page.getByLabel(it('ui.charges.unitPrice')).fill('35')
    await page.getByRole('button', { name: it('ui.charges.saveBilling') }).click()
    await page.getByText(it('flash.chargeBillingSaved')).waitFor()
    await page
      .getByTestId('charge-history')
      .getByText(it('ui.charges.events.billing_edited'))
      .waitFor()

    await page.getByRole('button', { name: it('ui.charges.markNotBillable') }).click()
    await page.getByTestId('charge-state').getByText(it('ui.charges.states.not_billable')).waitFor()

    await charge.refresh()
    assert.equal(charge.unitPrice, '35.0000')
  })

  test('Office adds a cost to the Job from its page', async ({ browserContext, visit }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer())

    const page = await visit(`/jobs/${job.id}`)
    await page.getByLabel(it('ui.charges.description')).fill('Collaboratore esterno')
    await page.getByLabel(it('ui.charges.quantity')).fill('8')
    await page.getByLabel(it('ui.charges.unit')).fill('h')
    await page.getByLabel(it('ui.charges.unitPrice')).fill('30')
    await page.getByLabel(it('ui.charges.vatKind')).selectOption('material')
    await page.getByRole('button', { name: it('ui.charges.add') }).click()

    await page.getByText(it('flash.chargeAdded')).waitFor()
    await page.getByTestId('charges').getByText('Collaboratore esterno').waitFor()
    await page.getByTestId('charges').getByText('240,00').waitFor()
  })
})
