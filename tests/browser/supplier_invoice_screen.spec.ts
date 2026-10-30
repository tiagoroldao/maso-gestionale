import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import SupplierInvoiceLine from '#models/supplier_invoice_line'
import SupplierInvoices from '#services/supplier_invoices'
import LegalStorage from '#services/legal_storage'
import SdiConnection from '#services/sdi_connection'
import { FakeSdiGateway } from '#services/sdi_gateway'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { supplierInvoiceLine, supplierInvoiceXml } from '#tests/helpers/supplier_invoices'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/** Office uploads the fixture (183.00, a valve line and a fittings line) */
async function uploaded() {
  const [invoice] = await SupplierInvoices.receive(
    { contents: Buffer.from(supplierInvoiceXml(), 'utf8'), name: 'fattura.xml' },
    { via: 'upload', user: await createUser('office') }
  )
  return invoice
}

/**
 * The Supplier Invoice page as an Entity screen (#243): docs/ui.md's rules
 * where they depend on the screen size, the Item's preview from a line,
 * the confirmations and dialogs, and their accessibility.
 */
test.group('Supplier Invoice screen in the browser', (group) => {
  let gateway: FakeSdiGateway
  group.each.setup(async () => {
    gateway = new FakeSdiGateway()
    SdiConnection.use(gateway)
    await completeCompany()
    return async () => {
      SdiConnection.restore()
      await rm(storagePath(), { recursive: true, force: true })
    }
  })

  test('on a phone: back to the inbox, no bottom bar, the original file in the header', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await createItem({ code: 'VALV34', supplierCode: 'VLV-034' })
    const invoice = await uploaded()

    const page = await visit(`/supplier-invoices/${invoice.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)

    await page
      .getByRole('link', {
        name: it('ui.screen.back', { label: it('ui.supplierInvoices.title') }),
      })
      .waitFor()
    assert.equal(await page.getByTestId('primary-action').count(), 0)
    const file = page
      .locator('main header')
      .getByRole('link', { name: it('ui.supplierInvoices.downloadFile') })
    assert.equal(await file.getAttribute('href'), `/supplier-invoices/${invoice.id}/file`)
    assert.equal(await file.getAttribute('target'), '_blank')
    await page
      .getByLabel(it('ui.screen.keyFacts'), { exact: true })
      .getByText('183,00 €', { exact: true })
      .waitFor()

    // Each line's form stacks on the phone
    const valve = supplierInvoiceLine(page, 'VLV-034')
    await valve.getByRole('button', { name: it('ui.supplierInvoices.receive') }).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('on a desktop: a received line opens its Item’s preview; undoing it asks first', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const valveItem = await createItem({ code: 'VALV34', supplierCode: 'VLV-034' })
    const invoice = await uploaded()

    const page = await visit(`/supplier-invoices/${invoice.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page
      .getByRole('navigation', { name: it('ui.screen.breadcrumb') })
      .getByRole('link', { name: it('ui.supplierInvoices.title') })
      .waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    const valve = supplierInvoiceLine(page, 'VLV-034')
    await valve.getByRole('button', { name: it('ui.supplierInvoices.receive') }).click()
    const received = valve.getByRole('button', {
      name: it('ui.supplierInvoices.receivedAs', { quantity: '10', unit: 'pz', code: 'VALV34' }),
    })

    // The Item, previewed over the invoice
    await received.click()
    const preview = page.getByRole('dialog')
    await preview.getByText(valveItem.description).waitFor()
    assert.equal(
      await preview
        .getByRole('link', { name: it('ui.screen.preview.openPage') })
        .getAttribute('href'),
      `/items/${valveItem.id}`
    )
    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'detached' })

    // Undoing the receipt takes stock back out: confirmed in the dialog first
    await valve.getByRole('button', { name: it('ui.supplierInvoices.undo') }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByText(it('ui.supplierInvoices.undoConfirm')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'confirmation')
    await confirm.getByRole('button', { name: it('ui.supplierInvoices.undoReceipt') }).click()
    await valve.getByRole('button', { name: it('ui.supplierInvoices.receive') }).waitFor()
    const line = await SupplierInvoiceLine.query()
      .where('supplierInvoiceId', invoice.id)
      .orderBy('position')
      .firstOrFail()
    assert.isNull(line.outcome)
  })

  test('in dark: an upload’s archiving failed; sending it asks SDI’s identifier in a dialog', async ({
    browserContext,
    visit,
    assert,
  }) => {
    gateway.legalStorage = true
    await LegalStorage.refresh(gateway)
    await browserContext.loginAs(await createUser('office'))
    const invoice = await uploaded()

    const page = await visit(`/supplier-invoices/${invoice.id}`)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    await page
      .getByTestId('legal-archiving')
      .getByText(it('ui.sdiFailures.noSdiIdentifier'), { exact: false })
      .waitFor()
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], size)
    }

    await page
      .locator('main header')
      .getByRole('button', { name: it('ui.supplierInvoices.legalArchivingSend') })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(it('ui.supplierInvoices.sdiIdentifier')).fill('12AB')
    await dialog.getByRole('button', { name: it('ui.supplierInvoices.legalArchivingSend') }).click()
    await dialog.getByText(it('validator.shared.messages.regex')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'dialog')

    await dialog.getByLabel(it('ui.supplierInvoices.sdiIdentifier')).fill('1084646898320')
    await dialog.getByRole('button', { name: it('ui.supplierInvoices.legalArchivingSend') }).click()
    await page.getByText(it('flash.supplierInvoiceArchived')).waitFor()
    await dialog.waitFor({ state: 'detached' })
    assert.lengthOf(gateway.archived, 1)
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'requested')
  })
})
