import { readFileSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import type { Page } from 'playwright'

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
 * different invoice, optionally citing delivery notes (DatiDDT) and with
 * discounts or surcharges on the whole document (ScontoMaggiorazione).
 */
export function supplierInvoiceXml(
  changes: {
    number?: string
    issuedOn?: string
    supplierVat?: string
    supplierName?: string
    buyerVat?: string
    deliveryNotes?: { number: string; date: string }[]
    discounts?: { type: 'SC' | 'MG'; percent?: string; amount?: string }[]
  } = {}
) {
  const discounts = (changes.discounts ?? [])
    .map((discount) =>
      [
        '<ScontoMaggiorazione>',
        `<Tipo>${discount.type}</Tipo>`,
        discount.percent ? `<Percentuale>${discount.percent}</Percentuale>` : '',
        discount.amount ? `<Importo>${discount.amount}</Importo>` : '',
        '</ScontoMaggiorazione>',
      ].join('')
    )
    .join('')
  const deliveryNotes = (changes.deliveryNotes ?? [])
    .map(
      (note) =>
        `<DatiDDT><NumeroDDT>${note.number}</NumeroDDT><DataDDT>${note.date}</DataDDT></DatiDDT>`
    )
    .join('')
  return readFileSync(SUPPLIER_INVOICE_XML, 'utf8')
    .replace('<ImportoTotaleDocumento>', `${discounts}<ImportoTotaleDocumento>`)
    .replace('</DatiGeneraliDocumento>', `</DatiGeneraliDocumento>${deliveryNotes}`)
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

/** A line written into a fixture invoice (DettaglioLinee) */
export type FixtureLine = {
  code?: string
  description: string
  quantity?: string
  unit?: string
  unitPrice: string
  /** A percentage discount (ScontoMaggiorazione SC), already applied to `total` */
  discountPercent?: string
  total: string
}

/**
 * The fixture's XML with other lines (its VAT summary unchanged), and
 * optionally another document type or currency.
 */
export function supplierInvoiceXmlWithLines(
  lines: FixtureLine[],
  changes: Parameters<typeof supplierInvoiceXml>[0] & {
    documentType?: string
    currency?: string
  } = {}
) {
  const details = lines
    .map((line, index) =>
      [
        '<DettaglioLinee>',
        `<NumeroLinea>${index + 1}</NumeroLinea>`,
        line.code
          ? `<CodiceArticolo><CodiceTipo>FORN</CodiceTipo><CodiceValore>${line.code}</CodiceValore></CodiceArticolo>`
          : '',
        `<Descrizione>${line.description}</Descrizione>`,
        line.quantity ? `<Quantita>${line.quantity}</Quantita>` : '',
        line.unit ? `<UnitaMisura>${line.unit}</UnitaMisura>` : '',
        `<PrezzoUnitario>${line.unitPrice}</PrezzoUnitario>`,
        line.discountPercent
          ? `<ScontoMaggiorazione><Tipo>SC</Tipo><Percentuale>${line.discountPercent}</Percentuale></ScontoMaggiorazione>`
          : '',
        `<PrezzoTotale>${line.total}</PrezzoTotale>`,
        '<AliquotaIVA>22.00</AliquotaIVA>',
        '</DettaglioLinee>',
      ].join('')
    )
    .join('\n')
  return supplierInvoiceXml(changes)
    .replace(/<DettaglioLinee>[\s\S]*<\/DettaglioLinee>/, details)
    .replace(
      '<TipoDocumento>TD01</TipoDocumento>',
      `<TipoDocumento>${changes.documentType ?? 'TD01'}</TipoDocumento>`
    )
    .replace('<Divisa>EUR</Divisa>', `<Divisa>${changes.currency ?? 'EUR'}</Divisa>`)
}

/** A line on a Supplier Invoice's page, found by its code or description */
export function supplierInvoiceLine(page: Page, text: string) {
  return page.getByTestId('supplier-invoice-line').filter({ hasText: text })
}
