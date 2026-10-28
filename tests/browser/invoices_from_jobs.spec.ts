import { test } from '@japa/runner'
import Invoice from '#models/invoice'
import Quotes from '#services/quotes'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

test.group('Invoices from Jobs in the browser', () => {
  test('from an accepted Quote to a finalised Invoice and its XML', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await completeCompany()
    const standard = await vatCode()
    const job = await createJob(await createCustomer(), { kind: 'quoted' })
    await Quotes.save(job, {
      lines: [
        {
          kind: 'call_out',
          description: 'Sopralluogo',
          quantity: '1',
          unitPrice: '50',
          vatCodeId: standard.id,
        },
      ],
    })
    await Quotes.accept(job)

    const page = await visit(`/jobs/${job.id}`)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: it('ui.invoices.fromQuote') }).click()
    await page.waitForURL(/\/invoices\/\d+\/edit$/)
    await page.getByRole('button', { name: it('ui.invoices.finalise') }).click()
    await page.getByRole('button', { name: it('ui.invoices.prepareSubmission') }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: /\.xml/ }).click()
    const file = await download

    assert.match(file.suggestedFilename(), /^IT\d+_M[0-9A-Z]{4}\.xml$/)
    const invoice = await Invoice.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.equal(invoice.status, 'finalised')
    assert.equal(invoice.totals.total, '61.00')
  })
})
