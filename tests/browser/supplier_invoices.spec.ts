import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import SupplierInvoice from '#models/supplier_invoice'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'
import { FIXTURE, SUPPLIER_INVOICE_P7M } from '#tests/helpers/supplier_invoices'

test.group('Supplier Invoices in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office uploads a signed invoice, reads it and marks it handled', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await completeCompany()
    await browserContext.loginAs(await createUser('office'))

    const inbox = await visit('/supplier-invoices')
    await inbox.getByLabel(it('ui.supplierInvoices.file')).setInputFiles(SUPPLIER_INVOICE_P7M)
    await inbox.getByRole('button', { name: it('ui.supplierInvoices.uploadSubmit') }).click()

    // Its page: the lines as the supplier wrote them
    await inbox.getByRole('cell', { name: 'VLV-034' }).waitFor()
    const invoice = await SupplierInvoice.firstOrFail()
    assert.include(inbox.url(), `/supplier-invoices/${invoice.id}`)
    await inbox.getByRole('button', { name: it('ui.supplierInvoices.markHandled') }).click()
    await inbox.getByRole('button', { name: it('ui.supplierInvoices.markToHandle') }).waitFor()
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')

    // Back in the inbox, handled
    await inbox.getByRole('link', { name: it('ui.nav.supplierInvoices') }).click()
    const row = inbox.getByRole('row', { name: new RegExp(FIXTURE.number) })
    await row.getByText(it('ui.supplierInvoices.statuses.handled')).waitFor()
  })
})
