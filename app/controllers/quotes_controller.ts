import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import User from '#models/user'
import Visit from '#models/visit'
import Quote from '#models/quote'
import QuoteLine from '#models/quote_line'
import LabourRate from '#models/labour_rate'
import VatCode from '#models/vat_code'
import CompanySettings from '#models/company_settings'
import VatDefaults from '#services/vat_defaults'
import Quotes, { QuoteImportRefusedError, QuoteNotEditableError } from '#services/quotes'
import DocumentRenderer from '#documents/document_renderer'
import { quoteDocument } from '#documents/quote_document'
import { PdfConversionError } from '#documents/pdf_converter'
import { quoteImportValidator, quoteValidator } from '#validators/quote'
import { localDateTime } from '#services/dates'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'
import type { HttpContext } from '@adonisjs/core/http'

async function loadJob(id: number) {
  return Job.query()
    .where('id', id)
    .preload('customer')
    .preload('quote', (quote) =>
      quote.preload('lines', (lines) => lines.orderBy('position').preload('item'))
    )
    .firstOrFail()
}

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

/**
 * A Job's Quote: written by Office, then accepted or declined.
 */
export default class QuotesController {
  async edit({ params, inertia }: HttpContext) {
    const job = await loadJob(params.id)
    const quote = job.quote ?? null
    const rates = await LabourRate.query().whereNull('archived_at').orderBy('name')
    const settings = await CompanySettings.current()
    // Importing lines as Charges (ADR 0012): how often each line was
    // imported, the open Visits to import onto, and who can work the hours
    const importable = quote?.status === 'accepted' && job.status !== 'cancelled'
    const imported = quote
      ? await db
          .from('charges')
          .whereIn(
            'quote_line_id',
            quote.lines.map((line) => line.id)
          )
          .groupBy('quote_line_id')
          .select('quote_line_id')
          .count('* as count')
      : []
    const visits = importable
      ? await Visit.query()
          .where('jobId', job.id)
          .whereNotIn('status', [...CLOSED_VISIT_STATUSES])
          .preload('technicians')
          .orderBy('startsAt')
      : []
    const technicians = importable
      ? await User.query().where('role', 'technician').where('isActive', true).orderBy('email')
      : []

    return inertia.render('quotes/edit', {
      job: {
        id: job.id,
        number: job.number,
        title: job.title,
        status: job.status,
        customer: job.customer.displayName,
      },
      quote: quote
        ? {
            status: quote.status,
            notes: quote.notes,
            validityDays: quote.validityDays,
            issuedOn: quote.issuedOn?.toISODate() ?? null,
            totals: quote.totals,
            lines: quote.lines.map((line) => ({
              id: line.id,
              imported: Number(imported.find((row) => row.quote_line_id === line.id)?.count ?? 0),
              vatCodeId: line.vatCodeId,
              kind: line.kind,
              itemId: line.itemId,
              labourRateId: line.labourRateId,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              significantGood: line.item?.significantGood ?? false,
            })),
          }
        : null,
      editable: Quotes.isEditable(job, quote),
      importable,
      openVisits: visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        technicianIds: visit.technicians.map((technician) => technician.id),
      })),
      technicians: technicians.map((user) => ({ id: user.id, name: user.fullName ?? user.email })),
      labourRates: rates.map((rate) => ({
        id: rate.id,
        name: rate.name,
        hourlyPrice: rate.hourlyPrice,
      })),
      callOutFee: settings.callOutFee ?? null,
      vatCodes: await vatCodeOptions(
        (quote?.lines ?? []).flatMap((line) => (line.vatCodeId ? [line.vatCodeId] : []))
      ),
      vatDefaults: await VatDefaults.idsForJob(job),
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
      await Quotes.save(job, {
        notes: data.notes ?? null,
        validityDays: data.validityDays ?? null,
        lines: data.lines,
      })
    } catch (error) {
      if (!(error instanceof QuoteNotEditableError)) throw error
      session.flash('error', i18n.t('flash.quoteNotEditable'))
      return response.redirect().toRoute('quotes.edit', { id: job.id })
    }

    session.flash('success', i18n.t('flash.quoteSaved'))
    response.redirect().toRoute('quotes.edit', { id: job.id })
  }

  /**
   * Imports the chosen lines of the accepted Quote as Charges, onto the
   * Job or one of its open Visits (ADR 0012).
   */
  async importLines({ params, request, response, session, auth, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(quoteImportValidator)

    try {
      const charges = await Quotes.importLines(job, data, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.quoteLinesImported', { count: charges.length }))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    } catch (error) {
      if (!(error instanceof QuoteImportRefusedError)) throw error
      session.flash('error', i18n.t(`flash.quoteImportRefused.${error.reason}`))
      return response.redirect().toRoute('quotes.edit', { id: job.id })
    }
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

    try {
      const pdf = await new DocumentRenderer().renderPdf(await quoteDocument(job, quote, i18n))
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
