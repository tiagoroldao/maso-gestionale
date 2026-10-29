import { readFileSync } from 'node:fs'
import { test } from '@japa/runner'
import {
  extractXml,
  FatturaReadError,
  readFatturaPA,
  type FatturaReadRefusal,
} from '#fiscal/fattura_pa_reader'
import { fatturaSchemaErrors } from '#tests/helpers/fattura_xsd'
import {
  SUPPLIER_INVOICE_P7M,
  SUPPLIER_INVOICE_STREAMED_P7M,
  SUPPLIER_INVOICE_XML,
  supplierInvoiceXml,
} from '#tests/helpers/supplier_invoices'

function refusal(read: () => unknown): FatturaReadRefusal | null {
  try {
    read()
    return null
  } catch (error) {
    if (error instanceof FatturaReadError) return error.reason
    throw error
  }
}

const fixture = () => readFileSync(SUPPLIER_INVOICE_XML, 'utf8')

test.group('Reading received FatturaPA files', () => {
  test('the fixture is valid FatturaPA', async ({ assert }) => {
    assert.deepEqual(await fatturaSchemaErrors(fixture()), [])
  })

  test('reads the supplier, the buyer, and the header, lines, VAT and payments', ({ assert }) => {
    const read = readFatturaPA(fixture())
    assert.equal(read.version, 'FPR12')
    assert.deepEqual(read.supplier, {
      name: 'Termoidraulica Forniture S.p.A.',
      vatCountry: 'IT',
      vatNumber: '03456789019',
      taxCode: null,
      address: {
        street: "Via dell'Industria",
        streetNumber: '8',
        postalCode: '37135',
        city: 'Verona',
        province: 'VR',
        country: 'IT',
      },
      email: 'fatture@termoforniture.example',
      phone: null,
    })
    assert.deepEqual(read.buyer, {
      name: 'Idraulica Maso S.r.l.',
      vatNumber: '01987654322',
      taxCode: null,
    })
    assert.lengthOf(read.invoices, 1)
    const [invoice] = read.invoices
    assert.deepInclude(invoice, {
      documentType: 'TD01',
      currency: 'EUR',
      number: 'FV-2026/1234',
      issuedOn: '2026-10-15',
      taxable: '150.00',
      vat: '33.00',
      total: '183.00',
      notes: ['Merce consegnata con DDT 812 del 14/10/2026'],
    })
    assert.deepEqual(invoice.lines, [
      {
        lineNumber: 1,
        code: 'VLV-034',
        description: 'Valvola a sfera 3/4" in ottone, è nichelata',
        quantity: '10',
        unit: 'PZ',
        unitPrice: '5.25',
        total: '52.5',
        vatRate: '22',
        natura: null,
      },
      {
        lineNumber: 2,
        code: null,
        description: 'Raccordi e guarnizioni',
        quantity: '1',
        unit: null,
        unitPrice: '97.5',
        total: '97.5',
        vatRate: '22',
        natura: null,
      },
    ])
    assert.deepEqual(invoice.summary, [
      { vatRate: '22', natura: null, taxable: '150', vat: '33', reference: null },
    ])
    assert.deepEqual(invoice.payments, [
      { method: 'MP05', dueOn: '2026-11-30', amount: '183', iban: 'IT60X0542811101000000123456' },
    ])
  })

  test('an FPA12 file, any namespace prefix, and a total worked out when missing', ({ assert }) => {
    const xml = fixture()
      .replace('versione="FPR12"', 'versione="FPA12"')
      .replaceAll('p:FatturaElettronica', 'ns3:FatturaElettronica')
      .replace('xmlns:p=', 'xmlns:ns3=')
      .replace('<ImportoTotaleDocumento>183.00</ImportoTotaleDocumento>', '')
    const read = readFatturaPA(xml)
    assert.equal(read.version, 'FPA12')
    assert.equal(read.invoices[0].total, '183.00')
  })

  test('a person as supplier, and several invoices in one file', ({ assert }) => {
    const xml = fixture()
      .replace(
        '<Denominazione>Termoidraulica Forniture S.p.A.</Denominazione>',
        '<Nome>Mario</Nome><Cognome>Rossi</Cognome>'
      )
      .replace(/(<FatturaElettronicaBody>[\s\S]*<\/FatturaElettronicaBody>)/, (body) =>
        [body, body.replace('<Numero>FV-2026/1234</Numero>', '<Numero>FV-2026/1235</Numero>')].join(
          '\n'
        )
      )
    const read = readFatturaPA(xml)
    assert.equal(read.supplier.name, 'Mario Rossi')
    assert.deepEqual(
      read.invoices.map((invoice) => invoice.number),
      ['FV-2026/1234', 'FV-2026/1235']
    )
  })

  test('decodes the encoding the XML declares', ({ assert }) => {
    const xml = fixture().replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')
    const read = readFatturaPA(extractXml(Buffer.from(xml, 'latin1')))
    assert.equal(
      read.invoices[0].lines[0].description,
      'Valvola a sfera 3/4" in ottone, è nichelata'
    )
    // A UTF-8 file with a byte order mark
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fixture(), 'utf8')])
    assert.equal(extractXml(bom), fixture())
  })

  test('extracts the XML from a signed .p7m: DER, streamed, or Base64', ({ assert }) => {
    for (const path of [SUPPLIER_INVOICE_P7M, SUPPLIER_INVOICE_STREAMED_P7M]) {
      assert.equal(extractXml(readFileSync(path)), fixture())
    }
    const base64 = Buffer.from(readFileSync(SUPPLIER_INVOICE_P7M).toString('base64'), 'latin1')
    assert.equal(extractXml(base64), fixture())
  })

  test('what it refuses', ({ assert }) => {
    // Not a signature, nor XML
    assert.equal(
      refusal(() => extractXml(Buffer.from('%PDF-1.4 not an invoice'))),
      'signature'
    )
    assert.equal(
      refusal(() => extractXml(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]))),
      'signature'
    )
    // A truncated signature
    const signed = readFileSync(SUPPLIER_INVOICE_P7M)
    assert.equal(
      refusal(() => extractXml(signed.subarray(0, 200))),
      'signature'
    )
    // Not well-formed, not FatturaPA, another version, or missing what an invoice needs
    assert.equal(
      refusal(() => readFatturaPA('<a><b></a>')),
      'unreadable'
    )
    assert.equal(
      refusal(() => readFatturaPA('<Ordine/>')),
      'unreadable'
    )
    assert.equal(
      refusal(() => readFatturaPA(fixture().replace('versione="FPR12"', 'versione="FSM10"'))),
      'unsupported'
    )
    assert.equal(
      refusal(() => readFatturaPA(supplierInvoiceXml().replace(/<Numero>.*<\/Numero>/, ''))),
      'unreadable'
    )
    assert.equal(
      refusal(() =>
        readFatturaPA(fixture().replace('<Data>2026-10-15</Data>', '<Data>ieri</Data>'))
      ),
      'unreadable'
    )
    // A day that doesn't exist, and a line number that isn't one
    assert.equal(
      refusal(() =>
        readFatturaPA(fixture().replace('<Data>2026-10-15</Data>', '<Data>2026-02-30</Data>'))
      ),
      'unreadable'
    )
    assert.equal(
      refusal(() =>
        readFatturaPA(
          fixture().replace('<NumeroLinea>2</NumeroLinea>', '<NumeroLinea>2.5</NumeroLinea>')
        )
      ),
      'unreadable'
    )
    assert.equal(
      refusal(() =>
        readFatturaPA(fixture().replace('<Imposta>33.00</Imposta>', '<Imposta>33,00</Imposta>'))
      ),
      'unreadable'
    )
    // No document type declarations (entities)
    assert.equal(
      refusal(() =>
        readFatturaPA(
          fixture().replace(
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE x [<!ENTITY a "b">]>'
          )
        )
      ),
      'unreadable'
    )
  })
})
