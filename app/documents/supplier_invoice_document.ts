import edge from 'edge.js'
import type { I18n } from '@adonisjs/i18n'
import type SupplierInvoice from '#models/supplier_invoice'
import { formatDate } from '#shared/dates'
import { vatLabel } from '#shared/vat'
import { documentTypeLabel, formatAmount, paymentMethodLabel } from '#shared/supplier_invoices'

const quantityFormat = new Intl.NumberFormat('it', { maximumFractionDigits: 8 })

/**
 * A Supplier Invoice as a self-contained HTML page to convert to PDF
 * (#200), with what its page in the inbox shows: the document, seller
 * and buyer as written in the file, lines, VAT summary and payments.
 * Not on the Base Layout: the Supplier issued it, so the company's
 * letterhead doesn't belong on it. The fiscal original stays the file;
 * this is a courtesy copy. Lines must be preloaded, in order.
 */
export function supplierInvoiceHtml(invoice: SupplierInvoice, i18n: I18n): Promise<string> {
  const t = (key: string, data?: Record<string, unknown>) => i18n.t(key, data)
  const money = (amount: string, decimals = 2) => formatAmount(amount, invoice.currency, decimals)
  const { seller, buyer, summary, payments, notes } = invoice.details
  const address = seller.address

  return edge.render('documents/supplier_invoice', {
    title: t('ui.supplierInvoices.showTitle', { number: invoice.number, supplier: seller.name }),
    documentType: `${documentTypeLabel(invoice.documentType, t)} (${invoice.documentType})`,
    number: invoice.number,
    issuedOn: formatDate(invoice.issuedOn.toISODate()),
    currency: invoice.currency,
    sdiIdentifier: invoice.sdiIdentifier,
    notes,
    seller: {
      name: seller.name,
      addressLines: address
        ? [
            [address.street, address.streetNumber].filter(Boolean).join(', '),
            [address.postalCode, address.city, address.province && `(${address.province})`]
              .filter(Boolean)
              .join(' '),
            address.country !== 'IT' ? address.country : null,
          ].filter(Boolean)
        : [],
      vatId: `${seller.vatCountry}${seller.vatNumber}`,
      taxCode: seller.taxCode,
    },
    buyer,
    lines: invoice.lines.map((line) => ({
      lineNumber: line.lineNumber,
      code: line.code ?? '',
      description: line.description,
      quantity:
        line.quantity === null
          ? ''
          : `${quantityFormat.format(line.quantity as unknown as number)} ${line.unit ?? ''}`.trim(),
      unitPrice: money(line.unitPrice, 8),
      total: money(line.total, 8),
      vat: vatLabel(line),
    })),
    summary: summary.map((row) => ({
      vat: vatLabel(row),
      taxable: money(row.taxable),
      vatAmount: money(row.vat),
      reference: row.reference ?? '',
    })),
    taxable: money(invoice.taxable),
    vat: money(invoice.vat),
    total: money(invoice.total),
    payments: payments.map((payment) => ({
      method: paymentMethodLabel(payment.method, t),
      dueOn: formatDate(payment.dueOn),
      iban: payment.iban ?? '',
      amount: money(payment.amount),
    })),
    fileName: invoice.fileName,
    t,
  })
}
