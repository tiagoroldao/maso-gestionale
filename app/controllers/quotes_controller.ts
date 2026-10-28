import edge from 'edge.js'
import Job from '#models/job'
import Quote from '#models/quote'
import QuoteLine from '#models/quote_line'
import LabourRate from '#models/labour_rate'
import VatCode from '#models/vat_code'
import CompanySettings from '#models/company_settings'
import Quotes, { QuoteNotEditableError } from '#services/quotes'
import DocumentRenderer from '#documents/document_renderer'
import { PdfConversionError } from '#documents/pdf_converter'
import { quoteValidator } from '#validators/quote'
import type { HttpContext } from '@adonisjs/core/http'

async function loadJob(id: number) {
  return Job.query()
    .where('id', id)
    .preload('customer')
    .preload('quote', (quote) => quote.preload('lines', (lines) => lines.orderBy('position')))
    .firstOrFail()
}

const euro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  useGrouping: 'always',
  maximumFractionDigits: 4,
})
const quantityFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 })

/**
 * Active VAT Codes, plus any the Quote's lines already use.
 */
async function vatCodeOptions(used: number[]) {
  const codes = await VatCode.query()
    .where((q) => q.withScopes((scopes) => scopes.active()).orWhereIn('id', used))
    .orderBy([
      { column: 'rate', order: 'desc' },
      { column: 'name', order: 'asc' },
    ])
  return codes.map((code) => ({
    id: code.id,
    name: code.name,
    rate: code.rate,
    natura: code.natura,
  }))
}

const vatLabel = (rate: string, natura: string | null) =>
  natura ?? `${Number(rate).toLocaleString('it-IT')}%`

/**
 * A Job's Quote: written by Office, then accepted or declined.
 */
export default class QuotesController {
  async edit({ params, inertia }: HttpContext) {
    const job = await loadJob(params.id)
    const quote = job.quote ?? null
    const rates = await LabourRate.query().whereNull('archived_at').orderBy('name')
    const settings = await CompanySettings.current()

    return inertia.render('quotes/edit', {
      job: {
        id: job.id,
        number: job.number,
        title: job.title,
        kind: job.kind,
        status: job.status,
        customer: job.customer.displayName,
      },
      quote: quote
        ? {
            status: quote.status,
            notes: quote.notes,
            totals: quote.totals,
            lines: quote.lines.map((line) => ({
              vatCodeId: line.vatCodeId,
              kind: line.kind,
              itemId: line.itemId,
              labourRateId: line.labourRateId,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            })),
          }
        : null,
      editable: Quotes.isEditable(job, quote),
      labourRates: rates.map((rate) => ({
        id: rate.id,
        name: rate.name,
        hourlyPrice: rate.hourlyPrice,
      })),
      callOutFee: settings.callOutFee ?? null,
      vatCodes: await vatCodeOptions(
        (quote?.lines ?? []).flatMap((line) => (line.vatCodeId ? [line.vatCodeId] : []))
      ),
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    // Lines already on the Quote may keep an Item or rate archived since
    const current = await QuoteLine.query().whereIn(
      'quoteId',
      Quote.query().select('id').where('jobId', job.id)
    )
    const data = await request.validateUsing(quoteValidator, {
      meta: {
        itemIds: current.flatMap((line) => (line.itemId ? [line.itemId] : [])),
        labourRateIds: current.flatMap((line) => (line.labourRateId ? [line.labourRateId] : [])),
        vatCodeIds: current.flatMap((line) => (line.vatCodeId ? [line.vatCodeId] : [])),
      },
    })

    try {
      await Quotes.save(job, { notes: data.notes ?? null, lines: data.lines })
    } catch (error) {
      if (!(error instanceof QuoteNotEditableError)) throw error
      session.flash('error', i18n.t('flash.quoteNotEditable'))
      return response.redirect().toRoute('quotes.edit', { id: job.id })
    }

    session.flash('success', i18n.t('flash.quoteSaved'))
    response.redirect().toRoute('quotes.edit', { id: job.id })
  }

  async accept({ params, response, session, i18n }: HttpContext) {
    return this.decide(params.id, 'accept', { response, session, i18n })
  }

  async decline({ params, response, session, i18n }: HttpContext) {
    return this.decide(params.id, 'decline', { response, session, i18n })
  }

  async pdf({ params, response, logger, i18n }: HttpContext) {
    const job = await loadJob(params.id)
    const quote = job.quote
    if (!quote) return response.notFound()

    const bodyHtml = await edge.render('documents/quote_body', {
      job: { number: job.number, title: job.title },
      issuedOn: (quote.updatedAt ?? quote.createdAt).toFormat('dd/MM/yyyy'),
      notes: quote.notes,
      taxable: euro.format(quote.totals.taxable as unknown as number),
      vat: euro.format(quote.totals.vat as unknown as number),
      total: euro.format(quote.totals.total as unknown as number),
      summary: quote.totals.summary.map((row) => ({
        vat: vatLabel(row.vatRate, row.natura),
        taxable: euro.format(row.taxable as unknown as number),
        vatAmount: euro.format(row.vat as unknown as number),
      })),
      legalNotes: [...new Set(quote.lines.flatMap((line) => line.legalNote ?? []))],
      lines: quote.lines.map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: line.quantity ? quantityFormat.format(line.quantity as unknown as number) : '',
        unit: line.unit ?? '',
        unitPrice: line.unitPrice ? euro.format(line.unitPrice as unknown as number) : '',
        lineTotal: line.lineTotal ? euro.format(line.lineTotal as unknown as number) : '',
        vat: line.vatRate !== null ? vatLabel(line.vatRate, line.natura) : '',
      })),
      t: (key: string, data?: Record<string, unknown>) => i18n.t(key, data),
    })

    try {
      const pdf = await new DocumentRenderer().renderPdf({
        title: i18n.t('documents.quote.title', { number: job.number }),
        recipient: job.customer.toRecipient(),
        bodyHtml,
      })
      response.header('content-type', 'application/pdf')
      response.header(
        'content-disposition',
        `inline; filename="preventivo-${job.number.replace('/', '-')}.pdf"`
      )
      return pdf
    } catch (error) {
      if (!(error instanceof PdfConversionError)) throw error
      logger.warn({ err: error }, 'PDF conversion failed')
      return response.serviceUnavailable(i18n.t('errors.pdfUnavailable'))
    }
  }

  private async decide(
    id: number,
    decision: 'accept' | 'decline',
    { response, session, i18n }: Pick<HttpContext, 'response' | 'session' | 'i18n'>
  ) {
    const job = await Job.findOrFail(id)
    try {
      await (decision === 'accept' ? Quotes.accept(job) : Quotes.decline(job))
    } catch (error) {
      if (!(error instanceof QuoteNotEditableError)) throw error
      session.flash('error', i18n.t('flash.quoteNotEditable'))
      return response.redirect().toRoute('quotes.edit', { id: job.id })
    }

    session.flash(
      'success',
      i18n.t(decision === 'accept' ? 'flash.quoteAccepted' : 'flash.quoteDeclined')
    )
    response.redirect().toRoute('jobs.show', { id: job.id })
  }
}
