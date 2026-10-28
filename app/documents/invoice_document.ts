import edge from 'edge.js'
import type { I18n } from '@adonisjs/i18n'
import type Invoice from '#models/invoice'
import { recipientFrom, type DocumentInput } from '#documents/document_renderer'
import { formatDate } from '#shared/dates'
import { BANK_TRANSFER } from '#shared/payments'

// Amounts in invoices are always in euro, with up to 4 decimals on prices
const euro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  useGrouping: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})
const quantityFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 })
const money = (amount: string) => euro.format(amount as unknown as number)
const vatLabel = (rate: string, natura: string | null) =>
  natura ?? `${Number(rate).toLocaleString('it-IT')}%`

/**
 * A finalised Invoice as a document on the Base Layout, built from the
 * Customer and company copies taken when it was finalised (lines must be
 * preloaded). The PDF is a courtesy copy; the fiscal original is the XML.
 */
export async function invoiceDocument(invoice: Invoice, i18n: I18n): Promise<DocumentInput> {
  const customer = invoice.customerSnapshot
  const company = invoice.companySnapshot
  if (invoice.status === 'draft' || !customer || !company) {
    throw new Error('Only finalised Invoices have a document')
  }
  const t = (key: string, data?: Record<string, unknown>) => i18n.t(key, data)
  const totals = invoice.totals
  const method = t(`ui.paymentMethods.${invoice.paymentMethod}`)
  const iban = invoice.paymentMethod === BANK_TRANSFER ? company.iban : null

  const bodyHtml = await edge.render('documents/invoice_body', {
    number: invoice.formattedNumber,
    issuedOn: formatDate(invoice.issuedOn!.toISODate()),
    dueOn: formatDate(invoice.dueOn!.toISODate()),
    payment: iban ? `${method} — ${t('documents.invoice.iban', { iban })}` : method,
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity:
        `${quantityFormat.format(line.quantity as unknown as number)} ${line.unit ?? ''}`.trim(),
      unitPrice: money(line.unitPrice),
      discount: Number(line.discountPercent)
        ? `${Number(line.discountPercent).toLocaleString('it-IT')}%`
        : '',
      vat: vatLabel(line.vatRate, line.natura),
      amount: money(line.lineTotal),
    })),
    summary: totals.summary.map((row) => ({
      vat: vatLabel(row.vatRate, row.natura),
      taxable: money(row.taxable),
      vatAmount: money(row.vat),
    })),
    discount: Number(totals.discount) ? money(`-${totals.discount}`) : null,
    taxable: money(totals.taxable),
    vat: money(totals.vat),
    total: money(totals.total),
    legalNotes: [...new Set(invoice.lines.flatMap((line) => line.legalNote ?? []))],
    notes: invoice.notes,
    t,
  })

  return {
    title: t('documents.invoice.title', { number: invoice.formattedNumber }),
    recipient: recipientFrom(customer),
    company,
    bodyHtml,
  }
}
