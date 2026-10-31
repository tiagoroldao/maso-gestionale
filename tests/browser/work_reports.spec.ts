import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import IssuedDocument from '#models/issued_document'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import { formatMoney } from '#shared/money'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('Work report in the browser (#180)', () => {
  test('Office issues a Job work report with prices from the Job page', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const anna = await createUser('technician', { fullName: 'Anna Neri' })
    const job = await createJob(await createCustomer({ name: 'Condominio Verdi' }), {
      status: 'in_progress',
    })
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const startsAt = DateTime.now().minus({ days: 2 }).set({ hour: 9, minute: 0 })
    const done = await Visit.create({
      jobId: job.id,
      startsAt,
      endsAt: startsAt.plus({ hours: 2 }),
      status: 'in_progress',
    })
    await done.related('technicians').attach([anna.id])
    await FieldWork.recordHours(done, { technicianId: anna.id, labourRateId: rate.id, hours: '2' })
    await FieldWork.setStatus(done, 'done', anna)

    const page = await visit(`/jobs/${job.id}`)
    await page
      .getByRole('link', { name: it('ui.jobs.issueWorkReport', { name: 'Rapportino di lavoro' }) })
      .click()
    // The Customer and the Job come along
    await page.getByText('Condominio Verdi').waitFor()
    await page
      .getByLabel('Commessa')
      .locator('option:checked', { hasText: job.number })
      .waitFor({ state: 'attached' })
    await page.getByLabel(it('ui.documentTemplates.fill.workReportPrices')).check()
    await page.getByRole('button', { name: it('ui.issuedDocuments.issue') }).click()

    // The issued document names its Job in the key facts
    await page
      .getByLabel(it('ui.screen.keyFacts'), { exact: true })
      .getByRole('link', { name: job.number, exact: true })
      .waitFor()
    const document = await IssuedDocument.firstOrFail()
    assert.equal(document.jobId, job.id)
    assert.deepEqual(document.tables.rapportino.rows.at(-1), [
      '',
      '',
      it('documents.workReport.total'),
      '',
      '',
      formatMoney('80'),
    ])
  })
})
