import edge from 'edge.js'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
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
            total: quote.total,
            lines: quote.lines.map((line) => ({
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
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(quoteValidator)

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
      total: euro.format(quote.total as unknown as number),
      lines: quote.lines.map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: line.quantity ? quantityFormat.format(line.quantity as unknown as number) : '',
        unit: line.unit ?? '',
        unitPrice: line.unitPrice ? euro.format(line.unitPrice as unknown as number) : '',
        lineTotal: line.lineTotal ? euro.format(line.lineTotal as unknown as number) : '',
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
