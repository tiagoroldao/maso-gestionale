import { readFile, rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { unzipSync } from 'fflate'
import SupplierInvoices from '#services/supplier_invoices'
import { storagePath } from '#services/storage'
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
})
