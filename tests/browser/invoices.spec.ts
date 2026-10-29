import { test } from '@japa/runner'
import Invoice from '#models/invoice'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import { completeCompany } from '#tests/helpers/company'
import { vatCode } from '#tests/helpers/items'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'

test.group('Invoices in the browser', () => {
  test('Office drafts a direct sale with a global discount, issues it and records the payment', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await completeCompany()
    await createCustomer({ name: 'Bar Centrale' })
    await createItem({ code: 'RUB-1', description: 'Rubinetto', resalePrice: '50' })

    const page = await visit('/invoices/create')
    await page.getByLabel(it('ui.customers.picker.label')).fill('Bar')
    await page.getByRole('option', { name: /Bar Centrale/ }).click()
    await page.getByRole('button', { name: it('ui.invoices.create') }).click()
    await page.waitForURL(/\/invoices\/\d+\/edit$/)

    await page.getByLabel(it('ui.invoices.addItem')).fill('rub')
    await page.getByRole('option', { name: /RUB-1/ }).click()
    await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).fill('2')
    await page.getByRole('button', { name: it('ui.invoices.addFreeLine') }).click()
    await page.getByLabel(it('ui.invoices.descriptionOf', { position: 2 })).fill('Posa')
    await page.getByLabel(it('ui.invoices.unitPriceOf', { position: 2 })).fill('100')
    await page.getByLabel(it('ui.invoices.globalDiscount')).fill('10')

    // (100 + 100) less 10% = 180, VAT 22% = 39.60
    await page.getByTestId('invoice-total').getByText('219,60 €').waitFor()
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await page.getByText(it('flash.invoiceSaved')).waitFor()

    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: it('ui.invoices.finalise') }).click()
    const number = `1/${new Date().getFullYear()}`
    await page.getByText(it('flash.invoiceFinalised', { number })).waitFor()

    // Paid in full at the counter
    await page.getByLabel(it('ui.invoices.amountPaid')).fill('219,60')
    await page.getByRole('button', { name: it('ui.invoices.recordPayment') }).click()
    await page.getByText(it('flash.paymentRecorded')).waitFor()
    await page.getByText(it('ui.invoices.paymentStatuses.paid'), { exact: true }).waitFor()

    const invoice = await Invoice.query().preload('lines').firstOrFail()
    assert.equal(invoice.totals.total, '219.60')
    assert.lengthOf(invoice.lines, 2)
    assert.equal(invoice.formattedNumber, number)
  })

  test('Office credits part of a delivered Invoice with a Credit Note', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await completeCompany()
    const invoice = await Invoices.create(await createCustomer({ name: 'Bar Centrale' }))
    const standard = await vatCode()
    await Invoices.save(invoice, {
      lines: [
        { description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id },
      ],
    })
    await Invoices.finalise(invoice)
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'delivered' })

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.getByRole('button', { name: it('ui.invoices.newCreditNote') }).click()
    await page.getByText(it('flash.creditNoteCreated')).waitFor()
    await page.getByLabel(it('ui.invoices.unitPriceOf', { position: 1 })).fill('25')
    await page.getByTestId('invoice-total').getByText('30,50 €').waitFor()
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await page.getByText(it('flash.invoiceSaved')).waitFor()

    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: it('ui.invoices.finaliseCreditNote') }).click()
    const number = `2/${new Date().getFullYear()}`
    await page.getByText(it('flash.creditNoteFinalised', { number })).waitFor()

    // Back on the Invoice: the Credit Note listed, 91.50 left to collect
    await page.getByTestId('credits').getByRole('link').click()
    await page.getByTestId('credit-notes').getByText(number).waitFor()
    await page.getByText(it('ui.invoices.credited', { amount: '30,50 €' })).waitFor()

    const note = await Invoice.findByOrFail('creditsInvoiceId', invoice.id)
    assert.equal(note.total, '30.50')
  })
})
