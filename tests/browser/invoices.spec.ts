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
import { SCREEN_SIZES } from '#shared/screen_sizes'

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

    // Irreversible, so asked first
    await page.getByRole('button', { name: it('ui.invoices.finalise') }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: it('ui.invoices.finalise') })
      .click()
    const number = `1/${new Date().getFullYear()}`
    await page.getByText(it('flash.invoiceFinalised', { number })).waitFor()

    // Paid in full at the counter, from the Payments section's dialog
    await page.getByRole('button', { name: it('ui.invoices.recordPayment') }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(it('ui.invoices.amountPaid')).fill('219,60')
    await dialog.getByRole('button', { name: it('ui.invoices.recordPayment') }).click()
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

    await page.getByRole('button', { name: it('ui.invoices.finaliseCreditNote') }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: it('ui.invoices.finaliseCreditNote') })
      .click()
    const number = `2/${new Date().getFullYear()}`
    await page.getByText(it('flash.creditNoteFinalised', { number })).waitFor()

    // Back on the Invoice: the Credit Note listed, 91.50 left to collect
    await page.getByRole('link', { name: `1/${new Date().getFullYear()}`, exact: true }).click()
    await page.getByTestId('credit-notes').getByText(number).waitFor()
    await page.getByText(it('ui.invoices.credited', { amount: '30,50 €' })).waitFor()

    const note = await Invoice.findByOrFail('creditsInvoiceId', invoice.id)
    assert.equal(note.total, '30.50')
  })

  test('a blocked Save is reached by keyboard and reads its reason, but neither click nor Enter submits (#295)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await completeCompany()
    await createCustomer({ name: 'Bar Centrale' })

    // No Customer picked yet: creating the draft is blocked, with its reason
    const page = await visit('/invoices/create')
    const create = page.getByRole('button', { name: it('ui.invoices.create') })
    await create.waitFor()
    assert.isNull(await create.getAttribute('disabled'))
    assert.equal(await create.getAttribute('aria-disabled'), 'true')
    // Tab from the breadcrumb reaches it, and it is described by its reason
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page
      .getByRole('navigation', { name: it('ui.screen.breadcrumb') })
      .getByRole('link', { name: it('ui.invoices.title') })
      .focus()
    await page.keyboard.press('Tab')
    assert.deepEqual(
      await page.evaluate(
        `(() => { const button = document.activeElement; return [button.textContent.trim(), document.getElementById(button.getAttribute('aria-describedby')).textContent.trim()] })()`
      ),
      [it('ui.invoices.create'), it('ui.invoices.pickCustomer')]
    )

    // Neither Enter on it, a click, nor Enter in a field submits the form
    const sent: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') sent.push(request.url())
    })
    await page.keyboard.press('Enter')
    await create.click({ force: true })
    const search = page.getByLabel(it('ui.customers.picker.label'))
    await search.fill('Nessuno')
    await search.press('Enter')
    await page.waitForTimeout(500)
    assert.deepEqual(sent, [])
    assert.match(page.url(), /\/invoices\/create$/)
    assert.lengthOf(await Invoice.all(), 0)
  })
})
