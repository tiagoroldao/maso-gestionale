import { test } from '@japa/runner'
import CompanySettings from '#models/company_settings'
import InvoiceSubmission from '#models/invoice_submission'
import Invoices from '#services/invoices'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { fatturaSchemaErrors } from '#tests/helpers/fattura_xsd'

async function finalisedInvoice() {
  const customer = await createCustomer({ name: 'Bar Centrale' })
  const invoice = await Invoices.create(customer)
  const standard = await vatCode()
  await Invoices.save(invoice, {
    discountPercent: '5',
    lines: [{ description: 'Intervento', quantity: '2', unitPrice: '50', vatCodeId: standard.id }],
  })
  await Invoices.finalise(invoice)
  return invoice
}

test.group('FatturaPA XML download', () => {
  test('a finalised Invoice downloads valid XML named as SDI expects', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany({
      taxCode: '01987654322',
      reaOffice: 'MI',
      reaNumber: '1234567',
      liquidationStatus: 'LN',
    })
    const invoice = await finalisedInvoice()

    await client.post(`/invoices/${invoice.id}/submissions`).withCsrfToken().loginAs(office)
    const submission = await InvoiceSubmission.findByOrFail('invoiceId', invoice.id)
    const response = await client.get(`/invoices/${invoice.id}/xml`).loginAs(office)

    response.assertStatus(200)
    response.assertHeader('content-type', 'application/xml; charset=utf-8')
    assert.include(
      response.header('content-disposition'),
      `filename="IT01987654322_${submission.progressive}.xml"`
    )
    const xml = response.text()
    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assert.include(xml, '<NumeroREA>1234567</NumeroREA>')
    assert.include(xml, '<Denominazione>Bar Centrale</Denominazione>')
    assert.include(xml, '<PrezzoTotale>-5.00</PrezzoTotale>')
  })

  test('drafts have no XML; Technicians are refused', async ({ client }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    await completeCompany()
    const draft = await Invoices.create(await createCustomer())
    const invoice = await finalisedInvoice()

    const missing = await client.get(`/invoices/${draft.id}/xml`).loginAs(office)
    missing.assertStatus(404)
    const refused = await client
      .get(`/invoices/${invoice.id}/xml`)
      .withInertia()
      .loginAs(technician)
    refused.assertStatus(403)
  })
})

test.group('REA in Company settings', () => {
  const fields = {
    name: 'Idraulica Maso S.r.l.',
    vatNumber: '01987654322',
    taxCode: '01987654322',
    taxRegime: 'RF01',
    street: 'Via dei Mille',
    postalCode: '20121',
    city: 'Milano',
    province: 'MI',
  }

  test('the Admin records the Registro Imprese details', async ({ client, assert }) => {
    const admin = await createUser('admin')

    await client
      .post('/settings/company')
      .form({
        ...fields,
        reaOffice: 'mi',
        reaNumber: '1234567',
        shareCapital: '10000,00',
        soleShareholder: 'SU',
        liquidationStatus: 'LN',
      })
      .withCsrfToken()
      .loginAs(admin)

    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.reaOffice, 'MI')
    assert.equal(settings.reaNumber, '1234567')
    assert.equal(settings.shareCapital, '10000.00')
    assert.equal(settings.soleShareholder, 'SU')
  })

  test('the REA office and number go together', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/company')
      .form({ ...fields, reaOffice: 'MI' })
      .header('referer', '/settings/company')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['reaNumber'])
    const settings = await CompanySettings.find(1)
    assert.isNull(settings?.reaOffice ?? null)
  })

  test('a finalised Invoice keeps the REA it was issued with', async ({ assert }) => {
    await completeCompany({ reaOffice: 'MI', reaNumber: '1234567', liquidationStatus: 'LN' })
    const invoice = await finalisedInvoice()
    await completeCompany({ reaOffice: 'RM', reaNumber: '999' })

    await invoice.refresh()
    assert.equal(invoice.companySnapshot?.rea?.number, '1234567')
  })
})
