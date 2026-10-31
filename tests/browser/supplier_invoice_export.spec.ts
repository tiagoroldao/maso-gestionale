import { readFile, rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { unzipSync } from 'fflate'
import SupplierInvoices from '#services/supplier_invoices'
import { storagePath } from '#services/storage'
import env from '#start/env'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'
import { FIXTURE, SUPPLIER_INVOICE_P7M } from '#tests/helpers/supplier_invoices'

test.group('Supplier Invoices export in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office downloads a month of Supplier Invoices as a zip', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await completeCompany()
    const office = await createUser('office')
    await SupplierInvoices.receive(
      { contents: await readFile(SUPPLIER_INVOICE_P7M), name: 'fattura.xml.p7m' },
      { via: 'upload', user: office }
    )
    await browserContext.loginAs(office)

    const inbox = await visit('/supplier-invoices')
    await inbox.getByLabel(it('ui.supplierInvoices.exportFrom'), { exact: true }).fill('2026-10-01')
    await inbox.getByLabel(it('ui.supplierInvoices.exportTo'), { exact: true }).fill('2026-10-31')
    const download = inbox.waitForEvent('download')
    await inbox.getByRole('button', { name: it('ui.supplierInvoices.exportSubmit') }).click()
    const file = await download

    assert.equal(file.suggestedFilename(), 'fatture-passive_2026-10-01_2026-10-31.zip')
    const zip = unzipSync(await readFile((await file.path())!))
    assert.deepEqual(Object.keys(zip), [
      'indice.csv',
      'originali/fattura.xml.p7m',
      `pdf/${FIXTURE.issuedOn}_Termoidraulica-Forniture-S-p-A_FV-2026-1234.pdf`,
    ])
  })

  test('a refused range keeps its dates (#209)', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))

    const inbox = await visit('/supplier-invoices')
    const from = inbox.getByLabel(it('ui.supplierInvoices.exportFrom'), { exact: true })
    const to = inbox.getByLabel(it('ui.supplierInvoices.exportTo'), { exact: true })
    // Backwards: refused by the validator
    await from.fill('2026-10-31')
    await to.fill('2026-10-01')
    await inbox.getByRole('button', { name: it('ui.supplierInvoices.exportSubmit') }).click()
    await inbox.getByText(it('validator.shared.messages.issuedTo.date.afterOrSameAs')).waitFor()
    assert.equal(await from.inputValue(), '2026-10-31')
    assert.equal(await to.inputValue(), '2026-10-01')

    // Nothing in the period: refused by the export
    await to.fill('2026-11-30')
    await inbox.getByRole('button', { name: it('ui.supplierInvoices.exportSubmit') }).click()
    await inbox.getByText(it('flash.supplierInvoiceExportEmpty')).waitFor()
    assert.equal(await from.inputValue(), '2026-10-31')
    assert.equal(await to.inputValue(), '2026-11-30')
  })

  test('PDFs unavailable: the refusal keeps the dates too (#209)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await completeCompany()
    const office = await createUser('office')
    await SupplierInvoices.receive(
      { contents: await readFile(SUPPLIER_INVOICE_P7M), name: 'fattura.xml.p7m' },
      { via: 'upload', user: office }
    )
    await browserContext.loginAs(office)

    const inbox = await visit('/supplier-invoices')
    const from = inbox.getByLabel(it('ui.supplierInvoices.exportFrom'), { exact: true })
    const to = inbox.getByLabel(it('ui.supplierInvoices.exportTo'), { exact: true })
    await from.fill('2026-10-01')
    await to.fill('2026-10-31')
    // Gotenberg down
    const gotenberg = env.get('GOTENBERG_URL')
    env.set('GOTENBERG_URL', 'http://127.0.0.1:9')
    try {
      await inbox.getByRole('button', { name: it('ui.supplierInvoices.exportSubmit') }).click()
      await inbox.getByText(it('errors.pdfUnavailable')).waitFor()
    } finally {
      env.set('GOTENBERG_URL', gotenberg)
    }
    assert.equal(await from.inputValue(), '2026-10-01')
    assert.equal(await to.inputValue(), '2026-10-31')
  })
})
