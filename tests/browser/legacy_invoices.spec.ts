import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import Invoice from '#models/invoice'
import Payment from '#models/payment'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'
import { chooseMoreAction } from '#tests/helpers/screen'

test.group('Legacy Invoices in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office records a paid Legacy advance from the Job', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer())

    const page = await visit(`/jobs/${job.id}`)
    await chooseMoreAction(page, it('ui.legacyInvoices.new'))
    await page.getByLabel(it('ui.legacyInvoices.number')).fill('42/2025')
    await page.getByLabel(it('ui.legacyInvoices.issuedOn')).fill('2025-09-15')
    await page.getByLabel(it('ui.legacyInvoices.taxable')).fill('100,00')
    await page.getByLabel(it('ui.legacyInvoices.vat'), { exact: true }).fill('22,00')
    await page.getByLabel(it('ui.legacyInvoices.total'), { exact: true }).fill('122,00')
    await page.getByLabel(it('ui.legacyInvoices.advance')).check()
    await page.getByRole('button', { name: it('ui.legacyInvoices.addRow') }).click()
    await page
      .getByLabel(it('ui.legacyInvoices.vatCodeOf', { position: 1 }))
      .selectOption({ label: '22%' })
    await page.getByLabel(it('ui.legacyInvoices.rowTaxableOf', { position: 1 })).fill('100')
    await page.getByLabel(it('ui.legacyInvoices.paidHint')).check()
    await page
      .getByLabel(it('ui.legacyInvoices.pdf'))
      .setInputFiles(app.makePath('tests/fixtures/manual.pdf'))
    await page.getByRole('button', { name: it('ui.legacyInvoices.create') }).click()
    await page.waitForURL(/\/invoices\/\d+\/legacy$/)
    await page.getByText(it('ui.invoices.paymentStatuses.paid'), { exact: true }).waitFor()

    const invoice = await Invoice.findByOrFail('legacyNumber', '42/2025')
    assert.equal(invoice.jobId, job.id)
    assert.isTrue(invoice.advance)
    assert.equal(invoice.total, '122.00')
    const rows = await db.from('legacy_vat_rows').where('invoice_id', invoice.id)
    assert.deepEqual(
      rows.map((row) => [row.vat_rate, row.taxable, row.vat]),
      [['22.00', '100.00', '22.00']]
    )
    const payments = await Payment.query().where('invoiceId', invoice.id)
    assert.deepEqual(
      payments.map((payment) => [payment.amount, payment.paidOn.toISODate()]),
      [['122.00', '2025-09-15']]
    )
  })

  test('Office corrects one on its page, keeping its PDF', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer()
    const invoice = await Invoice.create({
      customerId: customer.id,
      documentType: 'legacy',
      status: 'delivered',
      legacyNumber: '7/2025',
      issuedOn: DateTime.fromISO('2025-03-01'),
      dueOn: DateTime.fromISO('2025-03-31'),
      taxable: '100.00',
      vat: '22.00',
      total: '122.00',
      pdfPath: 'invoices/legacy/original.pdf',
      pdfName: 'originale.pdf',
    })

    const page = await visit(`/invoices/${invoice.id}/legacy`)
    await page.getByLabel(it('ui.legacyInvoices.number')).fill('7-bis/2025')
    await page.getByRole('button', { name: it('ui.legacyInvoices.save') }).click()
    await page.getByText(it('flash.legacyInvoiceSaved')).waitFor()

    await invoice.refresh()
    assert.equal(invoice.legacyNumber, '7-bis/2025')
    assert.equal(invoice.pdfPath, 'invoices/legacy/original.pdf')
    assert.equal(invoice.dueOn!.toISODate(), '2025-03-31')
  })
})
