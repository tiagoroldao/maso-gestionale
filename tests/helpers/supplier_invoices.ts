import { readFileSync } from 'node:fs'
import app from '@adonisjs/core/services/app'

/** A Supplier Invoice of 183.00 (150 + 22% VAT) from Termoidraulica Forniture */
export const SUPPLIER_INVOICE_XML = app.makePath('tests/fixtures/supplier_invoice.xml')
/** The same invoice, signed (.p7m, DER) */
export const SUPPLIER_INVOICE_P7M = app.makePath('tests/fixtures/supplier_invoice.xml.p7m')
/** The same invoice, signed with its content streamed in chunks (BER) */
export const SUPPLIER_INVOICE_STREAMED_P7M = app.makePath(
  'tests/fixtures/supplier_invoice_streamed.xml.p7m'
)

export const FIXTURE = {
  supplierVat: '03456789019',
  supplierName: 'Termoidraulica Forniture S.p.A.',
  buyerVat: '01987654322',
  number: 'FV-2026/1234',
  issuedOn: '2026-10-15',
}

/**
 * The fixture's XML with another number, date, supplier or buyer, as a
 * different invoice.
 */
export function supplierInvoiceXml(
  changes: {
    number?: string
    issuedOn?: string
    supplierVat?: string
    supplierName?: string
    buyerVat?: string
  } = {}
) {
  return readFileSync(SUPPLIER_INVOICE_XML, 'utf8')
    .replace(
      `<Numero>${FIXTURE.number}</Numero>`,
      `<Numero>${changes.number ?? FIXTURE.number}</Numero>`
    )
    .replace(
      `<Data>${FIXTURE.issuedOn}</Data>`,
      `<Data>${changes.issuedOn ?? FIXTURE.issuedOn}</Data>`
    )
    .replaceAll(FIXTURE.supplierVat, changes.supplierVat ?? FIXTURE.supplierVat)
    .replace(FIXTURE.supplierName, changes.supplierName ?? FIXTURE.supplierName)
    .replace(FIXTURE.buyerVat, changes.buyerVat ?? FIXTURE.buyerVat)
}
