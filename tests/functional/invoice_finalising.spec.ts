import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import InvoiceSequence from '#models/invoice_sequence'
import PaymentTerms from '#models/payment_terms'
import StockMovement from '#models/stock_movement'
import VatCode from '#models/vat_code'
import Invoices from '#services/invoices'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import i18nManager from '@adonisjs/i18n/services/main'
import DocumentRenderer from '#documents/document_renderer'
import { invoiceDocument } from '#documents/invoice_document'
import type { PdfConverter } from '#documents/pdf_converter'

const noConverter: PdfConverter = {
  convert: () => Promise.reject(new Error('renderHtml must not convert')),
}

async function invoiceHtml(invoice: Invoice) {
  await invoice.refresh()
  await invoice.load('lines')
  const input = await invoiceDocument(invoice, i18nManager.locale('it'))
  return new DocumentRenderer(noConverter).renderHtml(input)
}
import type Customer from '#models/customer'
import type Item from '#models/item'

async function draft(customer: Customer, item: Item | null = null, code?: VatCode) {
  const standard = code ?? (await vatCode())
  const invoice = await Invoices.create(customer)
  await Invoices.save(invoice, {
    lines: [
      item
        ? {
            itemId: item.id,
            description: item.description,
            quantity: '2',
            unitPrice: '10',
            vatCodeId: standard.id,
          }
        : { description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id },
    ],
  })
  return invoice
}

const year = () => DateTime.now().year

test.group('Finalising Invoices', () => {
  test('takes the next number and today, and copies Customer, company and terms', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const terms = await PaymentTerms.create({
      name: '30 gg fine mese',
      days: 30,
      endOfMonth: true,
      paymentMethod: 'MP05',
    })
    const customer = await createCustomer({ name: 'Bar Centrale', paymentTermsId: terms.id })
    const invoice = await draft(customer)

    const response = await client
      .post(`/invoices/${invoice.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('success', it('flash.invoiceFinalised', { number: `1/${year()}` }))
    await invoice.refresh()
    const today = DateTime.now().startOf('day')
    assert.equal(invoice.status, 'finalised')
    assert.equal(invoice.formattedNumber, `1/${year()}`)
    assert.equal(invoice.issuedOn?.toISODate(), today.toISODate())
    assert.equal(invoice.dueOn?.toISODate(), terms.dueDate(today).toISODate())
    assert.equal(invoice.paymentMethod, 'MP05')
    assert.equal(invoice.customerSnapshot?.name, 'Bar Centrale')
    assert.equal(invoice.companySnapshot?.vatNumber, '01987654322')
    const sequence = await InvoiceSequence.findByOrFail('year', year())
    assert.equal(sequence.nextNumber, 2)

    // Later edits to the Customer don't touch the issued Invoice
    customer.name = 'Bar Centrale di Rossi'
    await customer.save()
    await invoice.refresh()
    assert.equal(invoice.customerSnapshot?.name, 'Bar Centrale')
  })

  test('a finalised Invoice can not be edited, deleted or finalised again', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await draft(await createCustomer())
    await Invoices.finalise(invoice)
    const standard = await vatCode()

    for (const request of [
      client.put(`/invoices/${invoice.id}`).json({
        lines: [{ description: 'X', quantity: '1', unitPrice: '1', vatCodeId: standard.id }],
      }),
      client.delete(`/invoices/${invoice.id}`),
      client.post(`/invoices/${invoice.id}/finalise`),
    ]) {
      const response = await request.withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.invoiceNotEditable'))
    }
    await invoice.refresh()
    assert.equal(invoice.number, 1)
    const sequence = await InvoiceSequence.findByOrFail('year', year())
    assert.equal(sequence.nextNumber, 2)
  })

  test('refuses an empty draft, or while the company details are incomplete', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const withLines = await draft(customer)
    const empty = await Invoices.create(customer)

    const incomplete = await client
      .post(`/invoices/${withLines.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    incomplete.assertFlashMessage('error', it('flash.invoiceNotFinalisable.companyIncomplete'))

    await completeCompany()
    const noLines = await client
      .post(`/invoices/${empty.id}/finalise`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    noLines.assertFlashMessage('error', it('flash.invoiceNotFinalisable.empty'))

    await withLines.refresh()
    await empty.refresh()
    assert.deepEqual([withLines.status, empty.status], ['draft', 'draft'])
    assert.isNull(await InvoiceSequence.findBy('year', year()))
  })

  test('Items sold without a Visit leave the stock, referenced by the number', async ({
    assert,
  }) => {
    await completeCompany()
    const item = await createItem({ code: 'RUB-1' })
    const invoice = await draft(await createCustomer(), item)

    await Invoices.finalise(invoice)

    const [sale] = await StockMovement.query().where('itemId', item.id).where('kind', 'sale')
    assert.equal(sale.quantity, '-2.000')
    assert.equal(sale.reference, `1/${year()}`)
    assert.equal(sale.occurredOn.toISODate(), DateTime.now().toISODate())
  })

  test('lines keep the legal note of their VAT Code', async ({ assert }) => {
    await completeCompany()
    const reverse = await VatCode.findByOrFail('natura', 'N6.7')
    const invoice = await draft(await createCustomer(), null, reverse)
    reverse.legalNote = 'Nota cambiata dopo'
    await reverse.save()

    await invoice.load('lines')
    assert.include(invoice.lines[0].legalNote ?? '', 'art. 17')
  })

  test('the Admin sets where numbering starts until the year is locked', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    await completeCompany()

    await client
      .put(`/settings/invoice-numbering/${year()}`)
      .form({ nextNumber: '120' })
      .withCsrfToken()
      .loginAs(admin)
    const invoice = await draft(await createCustomer())
    await Invoices.finalise(invoice)
    await invoice.refresh()
    assert.equal(invoice.number, 120)

    const locked = await client
      .put(`/settings/invoice-numbering/${year()}`)
      .form({ nextNumber: '1' })
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    locked.assertFlashMessage('error', it('flash.numberingLocked', { year: year() }))
    const sequence = await InvoiceSequence.findByOrFail('year', year())
    assert.equal(sequence.nextNumber, 121)

    // Next year is still open
    await client
      .put(`/settings/invoice-numbering/${year() + 1}`)
      .form({ nextNumber: '5' })
      .withCsrfToken()
      .loginAs(admin)
    const next = await InvoiceSequence.findByOrFail('year', year() + 1)
    assert.equal(next.nextNumber, 5)

    const page = await client.get('/settings/invoice-numbering').withInertia().loginAs(admin)
    page.assertInertiaPropsContains({
      years: [
        { year: year(), nextNumber: 121, locked: true },
        { year: year() + 1, nextNumber: 5, locked: false },
      ],
    })

    const elsewhere = await client
      .put(`/settings/invoice-numbering/${year() - 1}`)
      .form({ nextNumber: '5' })
      .withCsrfToken()
      .loginAs(admin)
    elsewhere.assertStatus(404)
  })

  test('the PDF is for finalised Invoices only', async ({ client }) => {
    const office = await createUser('office')
    await completeCompany()
    const customer = await createCustomer()
    const draftInvoice = await draft(customer)
    const finalised = await draft(customer)
    await Invoices.finalise(finalised)

    const missing = await client.get(`/invoices/${draftInvoice.id}/pdf`).loginAs(office)
    missing.assertStatus(404)
    const pdf = await client.get(`/invoices/${finalised.id}/pdf`).loginAs(office)
    pdf.assertStatus(200)
    pdf.assertHeader('content-type', 'application/pdf')
  })

  test('the document shows the copies, the payment and the IBAN only for transfers', async ({
    assert,
  }) => {
    await completeCompany()
    const transfer = await PaymentTerms.create({
      name: 'Bonifico 30',
      days: 30,
      paymentMethod: 'MP05',
    })
    const cash = await PaymentTerms.create({ name: 'Contanti', days: 0, paymentMethod: 'MP01' })
    const byTransfer = await draft(
      await createCustomer({ name: 'Bar Centrale', paymentTermsId: transfer.id })
    )
    const inCash = await draft(await createCustomer({ name: 'Bar Sport', paymentTermsId: cash.id }))
    await Invoices.finalise(byTransfer)
    await Invoices.finalise(inCash)
    await completeCompany({ name: 'Nuova Ragione Sociale' })

    const html = await invoiceHtml(byTransfer)
    assert.include(html, 'Idraulica Maso S.r.l.')
    assert.notInclude(html, 'Nuova Ragione Sociale')
    assert.include(html, 'Bar Centrale')
    assert.include(
      html,
      `${it('ui.paymentMethods.MP05')} — ${it('documents.invoice.iban', { iban: 'IT60X0542811101000000123456' })}`
    )
    assert.include(html, 'Copia di cortesia')
    assert.notInclude(html, '@if')
    assert.notInclude(html, '@end')

    const cashHtml = await invoiceHtml(inCash)
    assert.include(cashHtml, it('ui.paymentMethods.MP01'))
    assert.notInclude(cashHtml, 'IT60X0542811101000000123456')
  })

  test('Office only: Technicians and the Admin-only numbering are refused', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    await completeCompany()
    const invoice = await draft(await createCustomer())

    const finalise = await client
      .post(`/invoices/${invoice.id}/finalise`)
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(technician)
      .redirects(0)
    finalise.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    const pdf = await client.get(`/invoices/${invoice.id}/pdf`).withInertia().loginAs(technician)
    pdf.assertStatus(403)
    for (const user of [office, technician]) {
      const numbering = await client.get('/settings/invoice-numbering').withInertia().loginAs(user)
      numbering.assertStatus(403)
      const change = await client
        .put(`/settings/invoice-numbering/${year()}`)
        .form({ nextNumber: '50' })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      change.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.isNull(await InvoiceSequence.findBy('year', year()))
  })
})

test.group('Finalising Invoices concurrently', () => {
  test('parallel finalising gives consecutive numbers, never a gap or a repeat', async ({
    assert,
    cleanup,
  }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)
    await completeCompany()
    const customer = await createCustomer()
    const drafts = []
    for (let i = 0; i < 6; i++) drafts.push(await draft(customer))

    // Separate pooled connections: real row locks, unlike the global transaction
    await Promise.all(drafts.map((invoice) => Invoices.finalise(invoice)))

    const finalised = await Invoice.query().whereIn(
      'id',
      drafts.map((invoice) => invoice.id)
    )
    const numbers = finalised.map((invoice) => invoice.number).sort((a, b) => a! - b!)
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6])
  }).tags(['@committed'])
})
