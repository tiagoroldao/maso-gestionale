import { existsSync, readFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'
import Supplier from '#models/supplier'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoices, { SupplierInvoiceRefusedError } from '#services/supplier_invoices'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import {
  FIXTURE,
  SUPPLIER_INVOICE_P7M,
  SUPPLIER_INVOICE_XML,
  supplierInvoiceXml,
} from '#tests/helpers/supplier_invoices'

type Upload = { contents: Buffer; name: string }

const xmlUpload = (changes: Parameters<typeof supplierInvoiceXml>[0] = {}): Upload => ({
  contents: Buffer.from(supplierInvoiceXml(changes), 'utf8'),
  name: 'IT03456789012_00042.xml',
})

/**
 * Uploads a file to the inbox as `user`: the fixture XML unless another
 * is given.
 */
function upload(client: ApiClient, user: User, file: Upload | string = SUPPLIER_INVOICE_XML) {
  const request = client.post('/supplier-invoices')
  const attached =
    typeof file === 'string'
      ? request.file('invoice', file)
      : request.file('invoice', file.contents, { filename: file.name })
  return attached.header('referer', '/supplier-invoices').withCsrfToken().loginAs(user).redirects(0)
}

/** The original files kept in storage */
async function storedFiles() {
  const directory = storagePath('supplier-invoices')
  return existsSync(directory) ? readdir(directory) : []
}

function refusal(reason: string) {
  return it(`flash.supplierInvoiceRefused.${reason}`)
}

test.group('Supplier Invoices', (group) => {
  group.each.setup(async () => {
    await completeCompany()
  })
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office uploads an XML file: its Supplier is created and the invoice is to handle', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')

    const response = await upload(client, office)
    const invoice = await SupplierInvoice.query().preload('supplier').firstOrFail()
    response.assertStatus(302)
    response.assertHeader('location', `/supplier-invoices/${invoice.id}`)
    response.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))

    // Its Supplier, created from the seller
    const supplier = invoice.supplier
    assert.deepInclude(supplier.serialize(), {
      name: FIXTURE.supplierName,
      vatCountry: 'IT',
      vatNumber: FIXTURE.supplierVat,
      taxCode: null,
      street: "Via dell'Industria 8",
      postalCode: '37135',
      city: 'Verona',
      province: 'VR',
      country: 'IT',
      email: 'fatture@termoforniture.example',
    })

    // The header, as read
    assert.deepInclude(invoice.serialize(), {
      documentType: 'TD01',
      currency: 'EUR',
      number: FIXTURE.number,
      taxable: '150.00',
      vat: '33.00',
      total: '183.00',
      status: 'to_handle',
      handledAt: null,
      receivedVia: 'upload',
      receivedBy: office.id,
      sdiIdentifier: null,
      fileName: 'supplier_invoice.xml',
    })
    assert.equal(invoice.issuedOn.toISODate(), FIXTURE.issuedOn)
    assert.match(invoice.filePath, /^supplier-invoices\/[0-9a-f-]+\.xml$/)
    assert.deepEqual(
      readFileSync(storagePath(invoice.filePath)),
      readFileSync(SUPPLIER_INVOICE_XML)
    )
    assert.deepEqual(invoice.details.payments, [
      { method: 'MP05', dueOn: '2026-11-30', amount: '183', iban: 'IT60X0542811101000000123456' },
    ])
    assert.deepEqual(invoice.details.notes, ['Merce consegnata con DDT 812 del 14/10/2026'])
    assert.equal(invoice.details.buyer.vatNumber, '01987654322')

    // Its lines
    await invoice.load('lines', (lines) => lines.orderBy('position'))
    assert.deepEqual(
      invoice.lines.map((line) => [
        line.lineNumber,
        line.code,
        line.quantity,
        line.unit,
        line.unitPrice,
        line.total,
        line.vatRate,
      ]),
      [
        [1, 'VLV-034', '10.00000000', 'PZ', '5.25000000', '52.50000000', '22.00'],
        [2, null, '1.00000000', null, '97.50000000', '97.50000000', '22.00'],
      ]
    )

    // In the inbox, and on its page
    const inbox = await client.get('/supplier-invoices').withInertia().loginAs(office)
    inbox.assertInertiaComponent('supplier_invoices/index')
    inbox.assertInertiaPropsContains({
      invoices: [
        {
          id: invoice.id,
          supplier: FIXTURE.supplierName,
          number: FIXTURE.number,
          issuedOn: FIXTURE.issuedOn,
          total: '183.00',
          status: 'to_handle',
        },
      ],
    })
    const page = await client.get(`/supplier-invoices/${invoice.id}`).withInertia().loginAs(office)
    page.assertInertiaComponent('supplier_invoices/show')
    page.assertInertiaPropsContains({
      invoice: {
        number: FIXTURE.number,
        supplier: { id: supplier.id, name: FIXTURE.supplierName },
        fileName: 'supplier_invoice.xml',
        lines: [{ lineNumber: 1, code: 'VLV-034' }, { lineNumber: 2 }],
        details: { summary: [{ vatRate: '22', taxable: '150', vat: '33' }] },
      },
    })

    // The original file, downloaded as it came
    const file = await client.get(`/supplier-invoices/${invoice.id}/file`).loginAs(office)
    file.assertStatus(200)
    assert.include(file.header('content-disposition'), 'attachment')
    assert.include(file.header('content-disposition'), 'supplier_invoice.xml')
    assert.equal(file.header('x-content-type-options'), 'nosniff')
    assert.equal(file.text(), readFileSync(SUPPLIER_INVOICE_XML, 'utf8'))
  })

  test('a signed .p7m is read the same, and is the same invoice as its XML', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')

    const response = await upload(client, office, SUPPLIER_INVOICE_P7M)
    response.assertStatus(302)
    const invoice = await SupplierInvoice.firstOrFail()
    assert.equal(invoice.number, FIXTURE.number)
    assert.equal(invoice.total, '183.00')
    assert.equal(invoice.fileName, 'supplier_invoice.xml.p7m')
    assert.match(invoice.filePath, /^supplier-invoices\/[0-9a-f-]+\.xml\.p7m$/)
    // The signed original is kept, not the XML inside it
    assert.deepEqual(
      readFileSync(storagePath(invoice.filePath)),
      readFileSync(SUPPLIER_INVOICE_P7M)
    )

    const again = await upload(client, office, SUPPLIER_INVOICE_XML)
    again.assertFlashMessage('error', refusal('duplicate'))
    again.assertHeader('location', '/supplier-invoices')
    assert.lengthOf(await SupplierInvoice.all(), 1)
    assert.lengthOf(await storedFiles(), 1)
  })

  test('the same invoice is refused; another number, date or supplier is a new one', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const first = await upload(client, office, xmlUpload())
    first.assertStatus(302)

    // The same supplier, number and date
    const same = await upload(client, office, xmlUpload())
    same.assertFlashMessage('error', refusal('duplicate'))
    assert.lengthOf(await SupplierInvoice.all(), 1)
    assert.lengthOf(await storedFiles(), 1)

    // Another number, another date: new invoices of the same Supplier
    for (const changes of [{ number: 'FV-2026/1235' }, { issuedOn: '2026-10-16' }]) {
      const response = await upload(client, office, xmlUpload(changes))
      response.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))
    }
    assert.lengthOf(await Supplier.all(), 1)

    // The same number and date from another supplier: a new Supplier
    const other = await upload(
      client,
      office,
      xmlUpload({ supplierVat: '04567890126', supplierName: 'Ferramenta Bianchi S.r.l.' })
    )
    other.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))
    const suppliers = await Supplier.query().orderBy('id')
    assert.deepEqual(
      suppliers.map((supplier) => [supplier.vatNumber, supplier.name]),
      [
        [FIXTURE.supplierVat, FIXTURE.supplierName],
        ['04567890126', 'Ferramenta Bianchi S.r.l.'],
      ]
    )
    assert.lengthOf(await SupplierInvoice.all(), 4)
    assert.lengthOf(await storedFiles(), 4)
  })

  test('a file holding several invoices records each; a repeat inside it is refused', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const xml = supplierInvoiceXml()
    const body = /<FatturaElettronicaBody>[\s\S]*<\/FatturaElettronicaBody>/.exec(xml)![0]
    const batch = (second: string) =>
      xml.replace(body, `${body}\n${body.replace(FIXTURE.number, second)}`)

    const repeated = await upload(client, office, {
      contents: Buffer.from(batch(FIXTURE.number)),
      name: 'lotto.xml',
    })
    repeated.assertFlashMessage('error', refusal('duplicate'))
    assert.lengthOf(await SupplierInvoice.all(), 0)

    const response = await upload(client, office, {
      contents: Buffer.from(batch('FV-2026/1235')),
      name: 'lotto.xml',
    })
    response.assertHeader('location', '/supplier-invoices')
    response.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 2 }))
    const invoices = await SupplierInvoice.query().orderBy('number')
    assert.deepEqual(
      invoices.map((invoice) => invoice.number),
      [FIXTURE.number, 'FV-2026/1235']
    )
    // One file for both
    assert.equal(invoices[0].filePath, invoices[1].filePath)
    assert.lengthOf(await storedFiles(), 1)
  })

  test('what is refused: other files, unreadable or unsigned ones, and invoices to others', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')

    // Only XML or .p7m
    const pdf = await upload(client, office, app.makePath('tests/fixtures/manual.pdf'))
    assert.deepEqual(pdf.flashMessage('inputErrorsBag').invoice, [
      it('validator.shared.messages.invoice.file.extname'),
    ])

    const cases: [string, Upload][] = [
      ['unreadable', { contents: Buffer.from('<Ordine>non una fattura</Ordine>'), name: 'a.xml' }],
      [
        'unsupported',
        {
          contents: Buffer.from(
            supplierInvoiceXml().replace('versione="FPR12"', 'versione="FSM10"')
          ),
          name: 'a.xml',
        },
      ],
      ['signature', { contents: Buffer.from('not a signature'), name: 'a.xml.p7m' }],
      // Addressed to another business, or one of the company's own invoices
      ['notForCompany', xmlUpload({ buyerVat: '12345678903' })],
    ]
    for (const [reason, file] of cases) {
      const response = await upload(client, office, file)
      response.assertHeader('location', '/supplier-invoices')
      response.assertFlashMessage('error', refusal(reason))
    }
    assert.lengthOf(await SupplierInvoice.all(), 0)
    assert.lengthOf(await Supplier.all(), 0)
    assert.lengthOf(await storedFiles(), 0)

    // The company's Codice Fiscale identifies it too
    await completeCompany({ taxCode: '98765432109' })
    const byTaxCode = supplierInvoiceXml({ buyerVat: '12345678903' }).replace(
      '</IdFiscaleIVA>\n        <Anagrafica>\n          <Denominazione>Idraulica Maso',
      '</IdFiscaleIVA>\n        <CodiceFiscale>98765432109</CodiceFiscale>\n        <Anagrafica>\n          <Denominazione>Idraulica Maso'
    )
    const accepted = await upload(client, office, {
      contents: Buffer.from(byTaxCode),
      name: 'b.xml',
    })
    accepted.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))

    // A file without an XML declaration is an XML file too
    const bare = supplierInvoiceXml({ number: 'FV-2026/9' }).replace(/^<\?xml[^>]*>\s*/, '')
    const read = await upload(client, office, { contents: Buffer.from(bare), name: 'c.XML' })
    read.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))

    // The buyer's VAT number written with its country prefix is still the company's
    const prefixed = await upload(
      client,
      office,
      xmlUpload({ number: 'FV-2026/10', buyerVat: 'IT01987654322' })
    )
    prefixed.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))
  })

  test('the SDI intermediary hands files to receive(); one already received is refused', async ({
    assert,
  }) => {
    const [invoice] = await SupplierInvoices.receive(xmlUpload(), {
      via: 'sdi',
      sdiIdentifier: '123456789',
    })
    assert.equal(invoice.receivedVia, 'sdi')
    assert.equal(invoice.sdiIdentifier, '123456789')
    assert.isNull(invoice.receivedBy)
    assert.equal(invoice.status, 'to_handle')

    const reasonOf = async (promise: Promise<unknown>) => {
      try {
        await promise
        return null
      } catch (error) {
        if (error instanceof SupplierInvoiceRefusedError) return error.reason
        throw error
      }
    }
    // The same SDI file, even read differently
    assert.equal(
      await reasonOf(
        SupplierInvoices.receive(xmlUpload({ number: 'X-1' }), {
          via: 'sdi',
          sdiIdentifier: '123456789',
        })
      ),
      'duplicate'
    )
    // The same invoice under another SDI identifier, or uploaded
    assert.equal(
      await reasonOf(
        SupplierInvoices.receive(xmlUpload(), { via: 'sdi', sdiIdentifier: '987654321' })
      ),
      'duplicate'
    )
    const office = await createUser('office')
    assert.equal(
      await reasonOf(SupplierInvoices.receive(xmlUpload(), { via: 'upload', user: office })),
      'duplicate'
    )
    assert.lengthOf(await SupplierInvoice.all(), 1)
    assert.lengthOf(await storedFiles(), 1)
  })

  test('Office marks one handled, and sets it back to handle', async ({ client, assert }) => {
    const office = await createUser('office')
    await upload(client, office)
    const invoice = await SupplierInvoice.firstOrFail()

    const handled = await client
      .post(`/supplier-invoices/${invoice.id}/handled`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    handled.assertHeader('location', `/supplier-invoices/${invoice.id}`)
    handled.assertFlashMessage('success', it('flash.supplierInvoiceHandled'))
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')
    assert.equal(invoice.handledBy, office.id)
    assert.isNotNull(invoice.handledAt)

    const back = await client
      .post(`/supplier-invoices/${invoice.id}/to-handle`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    back.assertFlashMessage('success', it('flash.supplierInvoiceToHandle'))
    await invoice.refresh()
    assert.equal(invoice.status, 'to_handle')
    assert.isNull(invoice.handledBy)
    assert.isNull(invoice.handledAt)
  })

  test('Office adds a Supplier by hand; its invoices then come to it', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const post = (fields: Record<string, string>) =>
      client
        .post('/suppliers')
        .form(fields)
        .header('referer', '/suppliers/create')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)

    const form = await client.get('/suppliers/create').withInertia().loginAs(office)
    form.assertInertiaComponent('suppliers/form')

    // A valid Partita IVA for Italy; letters and digits elsewhere
    const invalid = await post({ name: 'Termo', vatCountry: 'IT', vatNumber: '03456789013' })
    assert.deepEqual(invalid.flashMessage('inputErrorsBag').vatNumber, [
      it('validator.shared.messages.vatNumber', { field: 'Partita IVA' }),
    ])
    const foreign = await post({ name: 'Heizung GmbH', vatCountry: 'de', vatNumber: '123 456 789' })
    foreign.assertHeader('location', '/suppliers')
    const german = await Supplier.findByOrFail('vatCountry', 'DE')
    assert.equal(german.vatNumber, '123456789')

    const created = await post({
      name: 'Termoidraulica (a mano)',
      vatCountry: 'IT',
      vatNumber: ` ${FIXTURE.supplierVat}`,
      city: 'Verona',
    })
    created.assertFlashMessage('success', it('flash.supplierCreated'))
    const supplier = await Supplier.findByOrFail('vatNumber', FIXTURE.supplierVat)

    // One Supplier per VAT number
    const twice = await post({ name: 'Doppione', vatCountry: 'IT', vatNumber: FIXTURE.supplierVat })
    assert.deepEqual(twice.flashMessage('inputErrorsBag').vatNumber, [
      it('validator.shared.messages.supplierVatNumber.taken'),
    ])
    assert.lengthOf(await Supplier.all(), 2)

    // Its invoice arrives: it goes to that Supplier, whose details stay as entered
    await upload(client, office)
    const invoice = await SupplierInvoice.firstOrFail()
    assert.equal(invoice.supplierId, supplier.id)
    await supplier.refresh()
    assert.equal(supplier.name, 'Termoidraulica (a mano)')
    assert.isNull(supplier.street)

    // Details are corrected; the VAT number isn't
    const update = await client
      .put(`/suppliers/${supplier.id}`)
      .form({ name: 'Termoidraulica Forniture', vatNumber: '04567890126', province: 'vr' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    update.assertFlashMessage('success', it('flash.supplierSaved'))
    await supplier.refresh()
    assert.equal(supplier.name, 'Termoidraulica Forniture')
    assert.equal(supplier.province, 'VR')
    assert.isNull(supplier.city)
    assert.equal(supplier.vatNumber, FIXTURE.supplierVat)

    const list = await client.get('/suppliers').withInertia().loginAs(office)
    list.assertInertiaPropsContains({
      suppliers: [
        { name: 'Heizung GmbH', vatId: 'DE123456789', invoices: 0 },
        { id: supplier.id, vatId: `IT${FIXTURE.supplierVat}`, invoices: 1 },
      ],
    })
    const edit = await client.get(`/suppliers/${supplier.id}/edit`).withInertia().loginAs(office)
    edit.assertInertiaPropsContains({ supplier: { id: supplier.id, vatCountry: 'IT' } })
  })

  test('Technicians and the Superuser are refused on every route; Admins use them', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await upload(client, office)
    const invoice = await SupplierInvoice.query().preload('supplier').firstOrFail()
    const routes = [
      ['get', '/supplier-invoices'],
      ['post', '/supplier-invoices'],
      ['get', `/supplier-invoices/${invoice.id}`],
      ['get', `/supplier-invoices/${invoice.id}/file`],
      ['post', `/supplier-invoices/${invoice.id}/handled`],
      ['post', `/supplier-invoices/${invoice.id}/to-handle`],
      ['get', '/suppliers'],
      ['get', '/suppliers/create'],
      ['post', '/suppliers'],
      ['get', `/suppliers/${invoice.supplierId}/edit`],
      ['put', `/suppliers/${invoice.supplierId}`],
    ] as const

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const [method, url] of routes) {
        let request = client[method](url)
        if (url === '/supplier-invoices') {
          if (method === 'post') {
            request = request.file('invoice', Buffer.from(supplierInvoiceXml({ number: 'Z' })), {
              filename: 'z.xml',
            })
          }
        } else if (method !== 'get') {
          request = request.form({ name: 'Cambiato', vatCountry: 'IT', vatNumber: '04567890126' })
        }
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        if (method === 'get') response.assertStatus(403)
        else response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    // Nothing changed
    await invoice.refresh()
    assert.equal(invoice.status, 'to_handle')
    assert.lengthOf(await SupplierInvoice.all(), 1)
    const suppliers = await Supplier.all()
    assert.deepEqual(
      suppliers.map((supplier) => supplier.name),
      [FIXTURE.supplierName]
    )

    // Admins use every route
    const admin = await createUser('admin')
    for (const url of [
      '/supplier-invoices',
      `/supplier-invoices/${invoice.id}`,
      `/supplier-invoices/${invoice.id}/file`,
      '/suppliers',
      '/suppliers/create',
      `/suppliers/${invoice.supplierId}/edit`,
    ]) {
      const response = await client.get(url).loginAs(admin)
      response.assertStatus(200)
    }
    const uploaded = await upload(client, admin, xmlUpload({ number: 'A-1' }))
    uploaded.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))
    const handled = await client
      .post(`/supplier-invoices/${invoice.id}/handled`)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    handled.assertStatus(302)
    await invoice.refresh()
    assert.equal(invoice.handledBy, admin.id)
  })
})
