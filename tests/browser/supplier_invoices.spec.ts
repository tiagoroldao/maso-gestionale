import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import StockMovement from '#models/stock_movement'
import SupplierInvoice from '#models/supplier_invoice'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import { FIXTURE, SUPPLIER_INVOICE_P7M } from '#tests/helpers/supplier_invoices'

test.group('Supplier Invoices in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office uploads a signed invoice, receives a line and marks the other not stock', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await completeCompany()
    await browserContext.loginAs(await createUser('office'))
    const valve = await createItem({ code: 'VALV34', supplierCode: 'VLV-034' })

    const inbox = await visit('/supplier-invoices')
    await inbox.getByLabel(it('ui.supplierInvoices.file')).setInputFiles(SUPPLIER_INVOICE_P7M)
    await inbox.getByRole('button', { name: it('ui.supplierInvoices.uploadSubmit') }).click()

    // Its page: the lines as the supplier wrote them, the valve's Item suggested
    await inbox.getByRole('cell', { name: 'VLV-034' }).waitFor()
    const invoice = await SupplierInvoice.firstOrFail()
    assert.include(inbox.url(), `/supplier-invoices/${invoice.id}`)
    const valveRow = inbox.getByRole('row', { name: /VLV-034/ })
    await valveRow.getByText('VALV34').waitFor()
    await valveRow.getByRole('button', { name: it('ui.supplierInvoices.receive') }).click()
    await valveRow
      .getByRole('link', {
        name: it('ui.supplierInvoices.receivedAs', { quantity: '10', unit: 'pz', code: 'VALV34' }),
      })
      .waitFor()
    const [movement] = await StockMovement.query().where('itemId', valve.id)
    assert.equal(movement.quantity, '10.000')

    // The fittings are marked not stock: the invoice is handled
    const fittingsRow = inbox.getByRole('row', { name: /Raccordi e guarnizioni/ })
    await fittingsRow.getByRole('button', { name: it('ui.supplierInvoices.markNotStock') }).click()
    await inbox.getByText(it('ui.supplierInvoices.statuses.handled'), { exact: true }).waitFor()
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')

    // Back in the inbox, handled
    await inbox.getByRole('link', { name: it('ui.nav.supplierInvoices') }).click()
    const row = inbox.getByRole('row', { name: new RegExp(FIXTURE.number) })
    await row.getByText(it('ui.supplierInvoices.statuses.handled')).waitFor()
  })
})
