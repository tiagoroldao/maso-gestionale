import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import Invoice from '#models/invoice'
import Payment from '#models/payment'
import LegacyVatRow from '#models/legacy_vat_row'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { vatCode } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import { chooseMoreAction, holdSave } from '#tests/helpers/screen'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'
import Payments from '#services/payments'

/** A Legacy Invoice of 122.00 for `customer`, its PDF stored */
function legacyInvoice(customerId: number, fields: Partial<Invoice> = {}) {
  return Invoice.create({
    customerId,
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
    ...fields,
  })
}

/** A VAT row's error on its Imponibile, as the row shows it */
const rowTaxableError = it('ui.common.fieldError', {
  field: it('ui.legacyInvoices.rowTaxable'),
  message: '',
})

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

  test('saving twice uploads its new PDF once (#287)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer()
    const invoice = await legacyInvoice(customer.id)

    const page = await visit(`/invoices/${invoice.id}/legacy`)
    // Saved once the page it redirects to is back
    const save = async () => {
      const shown = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().endsWith(`/invoices/${invoice.id}/legacy`)
      )
      await page.getByRole('button', { name: it('ui.legacyInvoices.save') }).click()
      await shown
      await page.getByText(it('flash.legacyInvoiceSaved')).waitFor()
    }
    await page
      .getByLabel(it('ui.legacyInvoices.pdfReplace'))
      .setInputFiles(app.makePath('tests/fixtures/manual.pdf'))
    await save()
    await invoice.refresh()
    const replaced = invoice.pdfPath
    assert.notEqual(replaced, 'invoices/legacy/original.pdf')
    assert.equal(await page.getByLabel(it('ui.legacyInvoices.pdfReplace')).inputValue(), '')

    await page.getByLabel(it('ui.legacyInvoices.number')).fill('7-bis/2025')
    await save()
    await invoice.refresh()
    assert.equal(invoice.legacyNumber, '7-bis/2025')
    assert.equal(invoice.pdfPath, replaced)
  })

  test('on a phone, a new one starts from its Customer, then Registra is in the bar at the bottom', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await createCustomer({ name: 'Bar Centrale' })

    const page = await visit('/invoices/legacy/create')
    await page.setViewportSize(SCREEN_SIZES.phone)
    const bar = page.getByTestId('primary-action')
    assert.equal(await bar.count(), 0)
    await page.getByLabel(it('ui.customers.picker.label')).fill('Bar')
    await page.getByRole('option', { name: /Bar Centrale/ }).click()
    await page.waitForURL(/customerId=/)

    await bar.getByRole('button', { name: it('ui.legacyInvoices.create') }).waitFor()
    const box = await bar.boundingBox()
    assert.equal(Math.round((box?.y ?? 0) + (box?.height ?? 0)), SCREEN_SIZES.phone.height)
    // An advance's VAT rows stack, each field named above it
    await page.getByLabel(it('ui.legacyInvoices.advance')).check()
    await page.getByRole('button', { name: it('ui.legacyInvoices.addRow') }).click()
    await page.getByLabel(it('ui.legacyInvoices.rowTaxableOf', { position: 1 })).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    // Refused without a PDF: what was typed stays, the error under its field
    await page.getByLabel(it('ui.legacyInvoices.number')).fill('9/2025')
    await bar.getByRole('button', { name: it('ui.legacyInvoices.create') }).click()
    await page.locator('#legacy-pdf-error').waitFor()
    assert.equal(await page.getByLabel(it('ui.legacyInvoices.number')).inputValue(), '9/2025')
    // The empty VAT row: its own error, in the row
    const row = page.getByRole('listitem', { name: it('ui.legacyInvoices.rowOf', { position: 1 }) })
    await row.getByText(rowTaxableError).waitFor()
    assert.equal(
      await row
        .getByLabel(it('ui.legacyInvoices.rowTaxableOf', { position: 1 }))
        .getAttribute('aria-invalid'),
      'true'
    )
  })

  test('removing a VAT row after a refused save leaves each row its own errors (#287)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer()

    const page = await visit(`/invoices/legacy/create?customerId=${customer.id}`)
    await page.getByLabel(it('ui.legacyInvoices.advance')).check()
    const addRow = page.getByRole('button', { name: it('ui.legacyInvoices.addRow') })
    await addRow.click()
    await addRow.click()
    await page.getByLabel(it('ui.legacyInvoices.rowTaxableOf', { position: 1 })).fill('100')
    // Refused (no PDF, the second row empty)
    await page.getByRole('button', { name: it('ui.legacyInvoices.create') }).click()
    await page.locator('#legacy-pdf-error').waitFor()
    const row = (position: number) =>
      page.getByRole('listitem', { name: it('ui.legacyInvoices.rowOf', { position }) })
    await row(2).getByText(rowTaxableError).waitFor()
    assert.equal(await row(1).getByText(rowTaxableError).count(), 0)

    // The first removed: the empty one, now first, keeps its error
    await page
      .getByRole('button', { name: it('ui.legacyInvoices.removeRowOf', { position: 1 }) })
      .click()
    assert.equal(
      await page
        .getByRole('listitem', { name: it('ui.legacyInvoices.rowOf', { position: '' }) })
        .count(),
      1
    )
    await row(1).getByText(rowTaxableError).waitFor()
    assert.equal(
      await page
        .getByLabel(it('ui.legacyInvoices.rowTaxableOf', { position: 1 }))
        .getAttribute('aria-invalid'),
      'true'
    )

    // Saved again, held: until its answer each error stays on its row (#289)
    const save = await holdSave(page, {
      method: 'POST',
      path: '/invoices/legacy',
      answeredBy: '/invoices/legacy/create',
    })
    await page.getByRole('button', { name: it('ui.legacyInvoices.create') }).click()
    await save.sent
    assert.equal(await row(1).getByText(rowTaxableError).count(), 1)
    save.answer()
    await save.answered
    await row(1).getByText(rowTaxableError).waitFor()
    // A row added since has none
    await addRow.click()
    await row(2).waitFor()
    assert.equal(await row(2).getByText(rowTaxableError).count(), 0)
    assert.isNull(
      await page
        .getByLabel(it('ui.legacyInvoices.rowTaxableOf', { position: 2 }))
        .getAttribute('aria-invalid')
    )
  })

  test('on a desktop, the header reads its PDF, Crea nota di credito, Salva, "⋯"; deleting asks first', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer()
    const invoice = await legacyInvoice(customer.id)

    const page = await visit(`/invoices/${invoice.id}/legacy`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    const header = page.locator('main header')
    const pdf = header.getByRole('link', { name: it('ui.legacyInvoices.pdf') })
    assert.equal(await pdf.getAttribute('target'), '_blank')
    assert.equal(await pdf.getAttribute('href'), `/invoices/${invoice.id}/legacy/pdf`)
    const credit = await header
      .getByRole('button', { name: it('ui.invoices.newCreditNote') })
      .boundingBox()
    const save = await header
      .getByRole('button', { name: it('ui.legacyInvoices.save') })
      .boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(credit!.x, save!.x)
    assert.isBelow(save!.x, more!.x)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    await chooseMoreAction(page, it('ui.legacyInvoices.delete'))
    const confirm = page.getByRole('alertdialog')
    await confirm.getByText(it('ui.legacyInvoices.deleteConfirm')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'confirmation')
    await confirm.getByRole('button', { name: it('ui.legacyInvoices.delete') }).click()
    await page.waitForURL(/\/invoices$/)
    assert.isNull(await Invoice.find(invoice.id))
  })

  test('once paid it reads as text, its VAT rows too, and can no longer be deleted', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer()
    const job = await createJob(customer)
    const invoice = await legacyInvoice(customer.id, { jobId: job.id, advance: true })
    const standard = await vatCode()
    await LegacyVatRow.create({
      invoiceId: invoice.id,
      position: 0,
      vatCodeId: standard.id,
      vatRate: '22.00',
      natura: null,
      taxable: '100.00',
      vat: '22.00',
    })
    await Payments.record(invoice, { amount: '122', paidOn: DateTime.fromISO('2025-03-10') })

    const page = await visit(`/invoices/${invoice.id}/legacy`)
    await page.getByTestId('legacy-amounts').getByText('7/2025').waitFor()
    await page.getByTestId('legacy-vat-rows').getByText('22,00 €').waitFor()
    await page.getByRole('heading', { name: it('ui.legacyInvoices.details') }).waitFor()
    assert.equal(await page.getByText(it('ui.legacyInvoices.advanceHint')).count(), 0)
    assert.equal(await page.getByLabel(it('ui.legacyInvoices.number')).count(), 0)
    assert.equal(await page.getByRole('button', { name: it('ui.legacyInvoices.save') }).count(), 0)
    assert.equal(await page.getByRole('button', { name: it('ui.screen.moreActions') }).count(), 0)
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], size)
    }
  })
})
