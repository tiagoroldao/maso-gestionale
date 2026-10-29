import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { buffer } from 'node:stream/consumers'
import { test } from '@japa/runner'
import { ApiRequest, type ApiClient } from '@japa/api-client'
import i18nManager from '@adonisjs/i18n/services/main'
import { unzipSync, strFromU8 } from 'fflate'
import type User from '#models/user'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoices from '#services/supplier_invoices'
import SupplierInvoiceExport from '#services/supplier_invoice_export'
import { supplierInvoiceHtml } from '#documents/supplier_invoice_document'
import { PdfConversionError, type PdfConverter } from '#documents/pdf_converter'
import { storagePath } from '#services/storage'
import env from '#start/env'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'
import { FIXTURE, SUPPLIER_INVOICE_P7M, supplierInvoiceXml } from '#tests/helpers/supplier_invoices'

// The zip comes back as bytes
ApiRequest.addParser('application/zip', (response, done) => {
  const chunks: Buffer[] = []
  response.on('data', (chunk: Buffer) => chunks.push(chunk))
  response.on('end', () => done(null, Buffer.concat(chunks)))
})

const i18n = () => i18nManager.locale('it')

/** A converter standing in for Gotenberg: each PDF is its invoice's number */
const fakeConverter: PdfConverter = {
  convert: async (html) => Buffer.from(`%PDF ${/<strong>([^<]*)<\/strong>/.exec(html)![1]}`),
}

function exportPeriod(client: ApiClient, user: User, issuedFrom: string, issuedTo: string) {
  return client
    .get('/supplier-invoices/export')
    .qs({ issuedFrom, issuedTo })
    .header('referer', '/supplier-invoices')
    .loginAs(user)
    .redirects(0)
}

/**
 * Receives, as Office's upload, the fixture XML changed as given, named
 * `name`.
 */
async function receive(
  user: User,
  name: string,
  changes: Parameters<typeof supplierInvoiceXml>[0] = {}
) {
  const [invoice] = await SupplierInvoices.receive(
    { contents: Buffer.from(supplierInvoiceXml(changes), 'utf8'), name },
    { via: 'upload', user }
  )
  return invoice
}

test.group('Supplier Invoices: export for the commercialista', (group) => {
  group.each.setup(async () => {
    await completeCompany()
  })
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office downloads a period: originals, a PDF of each and the CSV index', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    // Signed, through the intermediary, on the 15th
    await SupplierInvoices.receive(
      { contents: readFileSync(SUPPLIER_INVOICE_P7M), name: 'IT03456789019_0A1B2.xml.p7m' },
      { via: 'sdi', sdiIdentifier: '012345678901' }
    )
    // Uploaded, from another supplier, on the 31st; its name holds a separator
    await receive(office, 'IT04567890126_00042.xml', {
      number: '0042',
      issuedOn: '2026-10-31',
      supplierVat: '04567890126',
      supplierName: 'Rossi; Bianchi &amp; C. S.n.c.',
    })
    // Outside the period, either side
    await receive(office, 'settembre.xml', { number: 'S-1', issuedOn: '2026-09-30' })
    await receive(office, 'novembre.xml', { number: 'N-1', issuedOn: '2026-11-01' })

    const response = await exportPeriod(client, office, '2026-10-01', '2026-10-31')
    response.assertStatus(200)
    response.assertHeader('content-type', 'application/zip')
    response.assertHeader(
      'content-disposition',
      'attachment; filename="fatture-passive_2026-10-01_2026-10-31.zip"'
    )
    const zip = unzipSync(response.body() as Buffer)

    const p7mPdf = 'pdf/2026-10-15_Termoidraulica-Forniture-S-p-A_FV-2026-1234.pdf'
    const xmlPdf = 'pdf/2026-10-31_Rossi-Bianchi-C-S-n-c_0042.pdf'
    assert.deepEqual(Object.keys(zip), [
      'indice.csv',
      'originali/IT03456789019_0A1B2.xml.p7m',
      p7mPdf,
      'originali/IT04567890126_00042.xml',
      xmlPdf,
    ])
    // The originals as received
    assert.deepEqual(
      Buffer.from(zip['originali/IT03456789019_0A1B2.xml.p7m']),
      readFileSync(SUPPLIER_INVOICE_P7M)
    )
    assert.equal(
      strFromU8(zip['originali/IT04567890126_00042.xml']),
      supplierInvoiceXml({
        number: '0042',
        issuedOn: '2026-10-31',
        supplierVat: '04567890126',
        supplierName: 'Rossi; Bianchi &amp; C. S.n.c.',
      })
    )
    // Rendered by Gotenberg
    for (const pdf of [p7mPdf, xmlPdf]) {
      assert.equal(strFromU8(zip[pdf].subarray(0, 5)), '%PDF-')
    }

    // The index: Excel in Italy reads it as it is
    const csv = Buffer.from(zip['indice.csv']).toString('utf8')
    assert.isTrue(csv.startsWith('\uFEFF'))
    const columns = (key: string) => it(`documents.supplierInvoiceExport.columns.${key}`)
    assert.deepEqual(csv.slice(1).split('\r\n'), [
      [
        'supplier',
        'vatId',
        'documentType',
        'number',
        'issuedOn',
        'taxable',
        'vat',
        'total',
        'currency',
        'sdiIdentifier',
        'receivedVia',
        'originalFile',
        'pdfFile',
      ]
        .map(columns)
        .join(';'),
      [
        FIXTURE.supplierName,
        `IT${FIXTURE.supplierVat}`,
        it('ui.supplierInvoices.documentTypes.TD01'),
        FIXTURE.number,
        '15/10/2026',
        '150,00',
        '33,00',
        '183,00',
        'EUR',
        '="012345678901"',
        it('documents.supplierInvoiceExport.receivedVia.sdi'),
        'originali/IT03456789019_0A1B2.xml.p7m',
        p7mPdf,
      ].join(';'),
      [
        '"Rossi; Bianchi & C. S.n.c."',
        'IT04567890126',
        it('ui.supplierInvoices.documentTypes.TD01'),
        '="0042"',
        '31/10/2026',
        '150,00',
        '33,00',
        '183,00',
        'EUR',
        '',
        it('documents.supplierInvoiceExport.receivedVia.upload'),
        'originali/IT04567890126_00042.xml',
        xmlPdf,
      ].join(';'),
      '',
    ])
  })

  test('a file holding several invoices is added once; a missing original is noted', async ({
    assert,
  }) => {
    const office = await createUser('office')
    const xml = supplierInvoiceXml()
    const body = /<FatturaElettronicaBody>[\s\S]*<\/FatturaElettronicaBody>/.exec(xml)![0]
    await SupplierInvoices.receive(
      {
        contents: Buffer.from(xml.replace(body, `${body}\n${body.replace(FIXTURE.number, 'B')}`)),
        name: 'lotto.xml',
      },
      { via: 'upload', user: office }
    )
    // Same received name, same supplier, number and date as a PDF name gives
    const lost = await receive(office, 'lotto.xml', { number: 'FV-2026 1234' })
    await rm(storagePath(lost.filePath))
    // A formula in a supplier's name stays text
    await receive(office, 'lotto.xml', {
      number: 'C',
      supplierVat: '04567890126',
      supplierName: '=HYPERLINK("x")',
    })

    const invoices = await SupplierInvoiceExport.invoicesIssuedIn('2026-10-15', '2026-10-15')
    const zip = unzipSync(
      await buffer(await SupplierInvoiceExport.zip(invoices, i18n(), fakeConverter))
    )
    assert.deepEqual(Object.keys(zip), [
      'indice.csv',
      'originali/lotto.xml',
      'pdf/2026-10-15_Termoidraulica-Forniture-S-p-A_FV-2026-1234.pdf',
      'pdf/2026-10-15_Termoidraulica-Forniture-S-p-A_B.pdf',
      'pdf/2026-10-15_Termoidraulica-Forniture-S-p-A_FV-2026-1234-2.pdf',
      'originali/lotto-2.xml',
      'pdf/2026-10-15_HYPERLINK-x_C.pdf',
    ])
    assert.equal(
      strFromU8(zip['pdf/2026-10-15_Termoidraulica-Forniture-S-p-A_FV-2026-1234-2.pdf']),
      '%PDF FV-2026 1234'
    )
    const rows = strFromU8(zip['indice.csv']).split('\r\n')
    assert.isTrue(
      rows[1].endsWith(
        ';originali/lotto.xml;pdf/2026-10-15_Termoidraulica-Forniture-S-p-A_FV-2026-1234.pdf'
      )
    )
    assert.isTrue(
      rows[2].endsWith(';originali/lotto.xml;pdf/2026-10-15_Termoidraulica-Forniture-S-p-A_B.pdf')
    )
    assert.include(rows[3], `;${it('documents.supplierInvoiceExport.originalMissing')};`)
    assert.isTrue(rows[4].startsWith(`"'=HYPERLINK(""x"")";IT04567890126;`))
  })

  test('Gotenberg down or nothing in the period: refused before anything is sent', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await receive(office, 'a.xml')
    const down: PdfConverter = {
      convert: () => Promise.reject(new PdfConversionError('Gotenberg is down')),
    }

    await assert.rejects(
      async () =>
        SupplierInvoiceExport.zip(await SupplierInvoice.query().preload('lines'), i18n(), down),
      PdfConversionError
    )
    // Down after the first PDF: the stream fails rather than ending as a zip missing PDFs
    await receive(office, 'b.xml', { number: 'B' })
    let conversions = 0
    const fails: PdfConverter = {
      convert: async (html) =>
        conversions++
          ? Promise.reject(new PdfConversionError('Gotenberg is down'))
          : fakeConverter.convert(html),
    }
    const stream = await SupplierInvoiceExport.zip(
      await SupplierInvoice.query().preload('lines'),
      i18n(),
      fails
    )
    await assert.rejects(() => buffer(stream), PdfConversionError)

    // Through the inbox: back to it, with the reason
    const gotenberg = env.get('GOTENBERG_URL')
    env.set('GOTENBERG_URL', 'http://127.0.0.1:9')
    try {
      const response = await exportPeriod(client, office, '2026-10-01', '2026-10-31')
      response.assertStatus(302)
      response.assertHeader('location', '/supplier-invoices')
      response.assertFlashMessage('error', it('errors.pdfUnavailable'))
    } finally {
      env.set('GOTENBERG_URL', gotenberg)
    }

    // Nothing in the period: said so, no empty zip
    const empty = await exportPeriod(client, office, '2026-11-01', '2026-11-30')
    empty.assertStatus(302)
    empty.assertHeader('location', '/supplier-invoices')
    empty.assertFlashMessage('error', it('flash.supplierInvoiceExportEmpty'))
  })

  test('the period needs both dates, the second not before the first', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await receive(office, 'a.xml')

    const backwards = await exportPeriod(client, office, '2026-10-31', '2026-10-01')
    backwards.assertStatus(302)
    backwards.assertHeader('location', '/supplier-invoices')
    assert.deepEqual(backwards.flashMessage('inputErrorsBag'), {
      issuedTo: [
        it('validator.shared.messages.date.afterOrSameAs', {
          field: it('validator.shared.fields.issuedTo'),
          otherField: it('validator.shared.fields.issuedFrom'),
        }),
      ],
    })

    const missing = await client
      .get('/supplier-invoices/export')
      .header('referer', '/supplier-invoices')
      .loginAs(office)
      .redirects(0)
    missing.assertStatus(302)
    assert.deepEqual(missing.flashMessage('inputErrorsBag'), {
      issuedFrom: [
        it('validator.shared.messages.required', {
          field: it('validator.shared.fields.issuedFrom'),
        }),
      ],
      issuedTo: [
        it('validator.shared.messages.required', { field: it('validator.shared.fields.issuedTo') }),
      ],
    })
  })

  test('the PDF shows the invoice as read from its file', async ({ assert }) => {
    const office = await createUser('office')
    const received = await receive(office, 'a.xml')
    const invoice = await SupplierInvoice.query()
      .where('id', received.id)
      .preload('lines', (lines) => lines.orderBy('position'))
      .firstOrFail()

    const html = await supplierInvoiceHtml(invoice, i18n())
    for (const text of [
      it('ui.supplierInvoices.showTitle', {
        number: FIXTURE.number,
        supplier: FIXTURE.supplierName,
      }),
      `IT${FIXTURE.supplierVat}`,
      'Idraulica Maso S.r.l.',
      'Valvola a sfera 3/4&quot; in ottone, è nichelata',
      '10 PZ',
      '5,25',
      '183,00',
      'IT60X0542811101000000123456',
      '30/11/2026',
      'Merce consegnata con DDT 812 del 14/10/2026',
    ]) {
      assert.include(html, text)
    }
  })

  test('Technicians and the Superuser are refused; Admins export', async ({ client }) => {
    const office = await createUser('office')
    await receive(office, 'a.xml')

    for (const role of ['technician', 'superuser'] as const) {
      const response = await exportPeriod(
        client,
        await createUser(role),
        '2026-10-01',
        '2026-10-31'
      )
      response.assertStatus(403)
    }
    const admin = await exportPeriod(client, await createUser('admin'), '2026-10-01', '2026-10-31')
    admin.assertStatus(200)
    admin.assertHeader('content-type', 'application/zip')
  })
})
