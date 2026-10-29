/**
 * Supplier Invoices (#198): received from suppliers, uploaded by Office or
 * delivered by the SDI intermediary (#92), and dealt with in an inbox.
 */

/**
 * An inbox entry is to handle until Office marks it handled (and can set
 * it back).
 */
export const SUPPLIER_INVOICE_STATUSES = ['to_handle', 'handled'] as const
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number]

/** How it arrived: uploaded by Office, or through the SDI intermediary */
export const SUPPLIER_INVOICE_SOURCES = ['upload', 'sdi'] as const
export type SupplierInvoiceSource = (typeof SUPPLIER_INVOICE_SOURCES)[number]

/**
 * FatturaPA document types (TipoDocumento) with a label in the catalogue
 * (`ui.supplierInvoices.documentTypes`); others are shown as their code.
 */
export const DOCUMENT_TYPES = [
  'TD01',
  'TD02',
  'TD03',
  'TD04',
  'TD05',
  'TD06',
  'TD16',
  'TD17',
  'TD18',
  'TD19',
  'TD20',
  'TD21',
  'TD22',
  'TD23',
  'TD24',
  'TD25',
  'TD26',
  'TD27',
  'TD28',
  'TD29',
] as const

/**
 * FatturaPA payment methods (ModalitaPagamento), all of them: a supplier
 * may use any (`ui.supplierInvoices.paymentMethods`).
 */
export const ALL_PAYMENT_METHODS = Array.from(
  { length: 23 },
  (_, index) => `MP${String(index + 1).padStart(2, '0')}`
)

/**
 * What a Supplier Invoice's page shows beyond its header and lines, as
 * read from the file: the seller and buyer as written, the VAT summary,
 * the payments due and the notes (Causale).
 */
export type SupplierInvoiceDetails = {
  version: 'FPR12' | 'FPA12'
  seller: {
    name: string
    vatCountry: string
    vatNumber: string
    taxCode: string | null
    address: {
      street: string
      streetNumber: string | null
      postalCode: string
      city: string
      province: string | null
      country: string
    } | null
  }
  buyer: { name: string; vatNumber: string | null; taxCode: string | null }
  summary: {
    vatRate: string
    natura: string | null
    taxable: string
    vat: string
    reference: string | null
  }[]
  payments: { method: string; dueOn: string | null; amount: string; iban: string | null }[]
  notes: string[]
}

/**
 * A FatturaPA document type (TipoDocumento) by name, or its code when the
 * catalogue doesn't name it; `t` is the server's or the pages' translator.
 */
export function documentTypeLabel(code: string, t: (key: string) => string) {
  return (DOCUMENT_TYPES as readonly string[]).includes(code)
    ? t(`ui.supplierInvoices.documentTypes.${code}`)
    : code
}

/** A payment method (ModalitaPagamento) by name, or its code */
export function paymentMethodLabel(code: string, t: (key: string) => string) {
  return ALL_PAYMENT_METHODS.includes(code)
    ? `${t(`ui.supplierInvoices.paymentMethods.${code}`)} (${code})`
    : code
}

/**
 * An amount in the invoice's currency, Italian style; unit prices keep up
 * to the 8 decimals FatturaPA allows.
 */
export function formatAmount(amount: string, currency: string, maxDecimals = 2) {
  try {
    return new Intl.NumberFormat('it', {
      style: 'currency',
      currency,
      useGrouping: 'always',
      minimumFractionDigits: 2,
      maximumFractionDigits: maxDecimals,
    }).format(amount as unknown as number)
  } catch {
    // Not a currency code Intl knows
    return `${amount} ${currency}`
  }
}
