import { test } from '@japa/runner'
import Invoice from '#models/invoice'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import { completeCompany } from '#tests/helpers/company'

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
})
