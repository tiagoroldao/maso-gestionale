import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import StockMovement from '#models/stock_movement'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoiceLine from '#models/supplier_invoice_line'
import SupplierInvoices from '#services/supplier_invoices'
import { storagePath } from '#services/storage'
import StockLedger from '#stock/stock_ledger'
import { formatDate } from '#shared/dates'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import {
  FIXTURE,
  SUPPLIER_INVOICE_P7M,
  supplierInvoiceLine,
  supplierInvoiceXml,
} from '#tests/helpers/supplier_invoices'

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
    await inbox.getByText('VLV-034', { exact: true }).waitFor()
    const invoice = await SupplierInvoice.firstOrFail()
    assert.include(inbox.url(), `/supplier-invoices/${invoice.id}`)
    const valveRow = supplierInvoiceLine(inbox, 'VLV-034')
    await valveRow.getByText('VALV34').waitFor()
    await valveRow.getByRole('button', { name: it('ui.supplierInvoices.receive') }).click()
    await valveRow
      .getByRole('button', {
        name: it('ui.supplierInvoices.receivedAs', { quantity: '10', unit: 'pz', code: 'VALV34' }),
      })
      .waitFor()
    const [movement] = await StockMovement.query().where('itemId', valve.id)
    assert.equal(movement.quantity, '10.000')

    // The fittings are marked not stock: the invoice is handled
    const fittingsRow = supplierInvoiceLine(inbox, 'Raccordi e guarnizioni')
    await fittingsRow.getByRole('button', { name: it('ui.supplierInvoices.markNotStock') }).click()
    await inbox.getByText(it('ui.supplierInvoices.statuses.handled'), { exact: true }).waitFor()
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')

    // Back in the inbox, handled
    await inbox
      .getByRole('navigation', { name: it('ui.screen.breadcrumb') })
      .getByRole('link', { name: it('ui.supplierInvoices.title') })
      .click()
    const row = inbox.getByRole('row', { name: new RegExp(FIXTURE.number) })
    await row.getByText(it('ui.supplierInvoices.statuses.handled')).waitFor()
  })

  test('Office spreads the invoice’s discount and marks a line already received by hand', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await completeCompany()
    const office = await createUser('office')
    await browserContext.loginAs(office)
    const valve = await createItem({ code: 'VALV34', supplierCode: 'VLV-034' })
    const receivedOn = DateTime.now().minus({ days: 2 })
    const byHand = await StockLedger.receive(valve, { quantity: '10', occurredOn: receivedOn })
    // 15.00 off the whole invoice: 5.25 of it on the valves' 52.50
    const [invoice] = await SupplierInvoices.receive(
      {
        contents: Buffer.from(
          supplierInvoiceXml({ discounts: [{ type: 'SC', amount: '15.00' }] }),
          'utf8'
        ),
        name: 'fattura.xml',
      },
      { via: 'upload', user: office }
    )

    const page = await visit(`/supplier-invoices/${invoice.id}`)
    const valveRow = supplierInvoiceLine(page, 'VLV-034')
    const cost = valveRow.getByLabel(it('ui.supplierInvoices.unitCost', { unit: 'pz' }))
    assert.equal(await cost.inputValue(), '5,25')
    await page.getByLabel(it('ui.supplierInvoices.spreadDiscounts')).check()
    await page.getByRole('button', { name: it('ui.supplierInvoices.spreadSave') }).click()
    await page.getByText(it('flash.supplierInvoiceSpread')).waitFor()
    assert.equal(await cost.inputValue(), '4,725')

    // The hint, then "già ricevuto" against that receipt
    await valveRow
      .getByText(
        it('ui.supplierInvoices.receivedByHand', {
          date: formatDate(receivedOn.toISODate()),
          quantity: '10',
          unit: 'pz',
        })
      )
      .waitFor()
    await valveRow.getByLabel(it('ui.supplierInvoices.alreadyReceived')).check()
    await valveRow.getByLabel(it('ui.supplierInvoices.earlierReceipt')).selectOption({
      label: it('ui.supplierInvoices.earlierReceiptOption', {
        date: formatDate(receivedOn.toISODate()),
        quantity: '10',
        unit: 'pz',
        reference: '',
      }),
    })
    await valveRow
      .getByRole('button', { name: it('ui.supplierInvoices.markAlreadyReceived') })
      .click()
    await valveRow
      .getByRole('button', {
        name: it('ui.supplierInvoices.alreadyReceivedAs', { code: 'VALV34' }),
      })
      .waitFor()

    // No stock moved; the receipt by hand took the cost
    assert.lengthOf(await StockMovement.query().where('itemId', valve.id), 1)
    await byHand.refresh()
    assert.equal(byHand.unitCost, '4.7250')
    const line = await SupplierInvoiceLine.query()
      .where('supplierInvoiceId', invoice.id)
      .orderBy('position')
      .firstOrFail()
    assert.equal(line.outcome, 'already_received')
    assert.equal(line.stockMovementId, byHand.id)
  })
})
