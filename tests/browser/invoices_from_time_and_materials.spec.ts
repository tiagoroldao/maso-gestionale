import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

test.group('Invoices from Time & Materials in the browser', () => {
  test('Office drafts the Invoice from the hours recorded on a Job', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const anna = await createUser('technician')
    const job = await createJob(await createCustomer(), {
      kind: 'time_and_materials',
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
    await FieldWork.recordHours(done, { technicianId: anna.id, labourRateId: rate.id, hours: '2' })
    await FieldWork.setStatus(done, 'done', anna)

    const page = await visit(`/jobs/${job.id}`)
    await page.getByRole('button', { name: it('ui.invoices.fromTimeAndMaterials') }).click()
    await page.waitForURL(/\/invoices\/\d+\/edit$/)

    // 2 h × 40 = 80, reverse charged by the default rules (company maintenance)
    await page.getByTestId('invoice-total').getByText('80,00 €').waitFor()
    const invoice = await Invoice.findByOrFail('jobId', job.id)
    assert.equal(invoice.status, 'draft')
  })
})
