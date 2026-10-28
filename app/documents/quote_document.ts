import edge from 'edge.js'
import type { I18n } from '@adonisjs/i18n'
import type Quote from '#models/quote'
import { recipientFrom, type DocumentInput } from '#documents/document_renderer'

const euro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  useGrouping: 'always',
  maximumFractionDigits: 4,
})
const quantityFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 })
const money = (amount: string) => euro.format(amount as unknown as number)
const vatLabel = (rate: string, natura: string | null) =>
  natura ?? `${Number(rate).toLocaleString('it-IT')}%`

/**
 * A Quote as a document on the Base Layout (its Job preloaded with the
 * Customer, and its lines): numbered from its Job ("2026/0007-2"), dated
 * by its issue date, with the optional validity, the lines, the VAT
 * summary and the legal notes. The subject is the Job's title, which every
 * Quote of the Job shares. Once sent it prints the Customer, company and
 * subject copied then; a draft reads them as they are now.
 */
export async function quoteDocument(quote: Quote, i18n: I18n): Promise<DocumentInput> {
  const t = (key: string, data?: Record<string, unknown>) => i18n.t(key, data)
  const job = quote.job
  const issuedOn = quote.issuedOn ?? quote.createdAt
  const bodyHtml = await edge.render('documents/quote_body', {
    job: { title: quote.subject ?? job.title },
    issuedOn: issuedOn.toFormat('dd/MM/yyyy'),
    validUntil: quote.validityDays
      ? issuedOn.plus({ days: quote.validityDays }).toFormat('dd/MM/yyyy')
      : null,
    notes: quote.notes,
    taxable: money(quote.totals.taxable),
    vat: money(quote.totals.vat),
    total: money(quote.totals.total),
    summary: quote.totals.summary.map((row) => ({
      vat: vatLabel(row.vatRate, row.natura),
      taxable: money(row.taxable),
      vatAmount: money(row.vat),
    })),
    legalNotes: [...new Set(quote.lines.flatMap((line) => line.legalNote ?? []))],
    lines: quote.lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      quantity: line.quantity ? quantityFormat.format(line.quantity as unknown as number) : '',
      unit: line.unit ?? '',
      unitPrice: line.unitPrice ? money(line.unitPrice) : '',
      lineTotal: line.lineTotal ? money(line.lineTotal) : '',
      vat: line.vatRate !== null ? vatLabel(line.vatRate, line.natura) : '',
    })),
    t,
  })

  return {
    title: t('documents.quote.title', { number: quote.number }),
    recipient: quote.customerSnapshot
      ? recipientFrom(quote.customerSnapshot)
      : job.customer.toRecipient(),
    company: quote.companySnapshot ?? undefined,
    bodyHtml,
  }
}
