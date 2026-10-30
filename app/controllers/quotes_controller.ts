import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import User from '#models/user'
import Visit from '#models/visit'
import Quote from '#models/quote'
import LabourRate from '#models/labour_rate'
import VatCode from '#models/vat_code'
import CompanySettings from '#models/company_settings'
import VatDefaults from '#services/vat_defaults'
import Quotes, { QuoteImportRefusedError, QuoteNotEditableError } from '#services/quotes'
import DocumentRenderer from '#documents/document_renderer'
import { quoteDocument } from '#documents/quote_document'
import { PdfConversionError } from '#documents/pdf_converter'
import { quoteImportValidator, quoteValidator } from '#validators/quote'
import { quoteActions } from '#services/quote_actions'
import { localDateTime } from '#services/dates'
import { flashWithStockWarning } from '#stock/stock_warning'
import { OPEN_VISIT_STATUSES } from '#shared/visits'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * A Job's Quotes (ADR 0013): each written by Office as a draft, sent, then
 * accepted or declined on its own.
 */
export default class QuotesController {
  /**
   * The editor for a new Quote on the Job, saved as a draft (store).
   */
  async create({ params, inertia, session, response, i18n, bouncer }: HttpContext) {
    const job = await Job.query().where('id', params.id).preload('customer').firstOrFail()
    if (!Quotes.canWrite(job)) {
      session.flash('error', i18n.t('flash.quoteNotWritable'))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    }
    return inertia.render('quotes/edit', {
      ...(await pageProps(job, null, bouncer)),
      actions: quoteActions(
        { quote: null, editable: true, sendable: false, decidable: false },
        i18n
      ),
      editable: true,
      sendable: false,
      decidable: false,
      importable: false,
      openVisits: [],
      technicians: [],
    })
  }

  async store({ params, request, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(quoteValidator, {
      meta: { itemIds: [], labourRateIds: [], vatCodeIds: [] },
    })

    let quote
    try {
      quote = await Quotes.create(job, {
        notes: data.notes ?? null,
        validityDays: data.validityDays ?? null,
        lines: data.lines,
      })
    } catch (error) {
      if (!(error instanceof QuoteNotEditableError)) throw error
      session.flash('error', i18n.t('flash.quoteNotWritable'))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    }

    session.flash('success', i18n.t('flash.quoteSaved'))
    response.redirect().toRoute('quotes.edit', { id: quote.id })
  }

  async edit({ params, inertia, i18n, bouncer }: HttpContext) {
    const quote = await loadQuote(params.id)
    const job = quote.job
    // Importing lines as Charges (ADR 0012): how often each line was
    // imported, the open Visits to import onto, and who can work the hours
    const importable = quote.status === 'accepted' && job.isActive
    const imported = await db
      .from('charges')
      .whereIn(
        'quote_line_id',
        quote.lines.map((line) => line.id)
      )
      .groupBy('quote_line_id')
      .select('quote_line_id')
      .count('* as count')
    const visits = importable
      ? await Visit.query()
          .where('jobId', job.id)
          .whereIn('status', [...OPEN_VISIT_STATUSES])
          .preload('technicians')
          .orderBy('startsAt')
      : []
    const technicians = importable
      ? await User.query().where('role', 'technician').where('isActive', true).orderBy('email')
      : []

    const editable = Quotes.isEditable(job, quote)
    const sendable = Quotes.isSendable(job, quote)
    const decidable = Quotes.isDecidable(job, quote)

    return inertia.render('quotes/edit', {
      ...(await pageProps(job, quote, bouncer)),
      actions: quoteActions(
        {
          quote: { id: quote.id, number: quote.number, total: quote.totals.total },
          editable,
          sendable,
          decidable,
        },
        i18n
      ),
      quote: {
        id: quote.id,
        number: quote.number,
        status: quote.status,
        sentAt: quote.sentAt ? localDateTime(quote.sentAt) : null,
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
      },
      editable,
      sendable,
      decidable,
      importable,
      openVisits: visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        technicianIds: visit.technicians.map((technician) => technician.id),
      })),
      technicians: technicians.map((user) => ({ id: user.id, name: user.fullName ?? user.email })),
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const quote = await Quote.query().where('id', params.id).preload('lines').firstOrFail()
    // Lines already on the Quote may keep an Item or rate archived since
    const data = await request.validateUsing(quoteValidator, {
      meta: {
        itemIds: quote.lines.flatMap((line) => (line.itemId ? [line.itemId] : [])),
        labourRateIds: quote.lines.flatMap((line) =>
          line.labourRateId ? [line.labourRateId] : []
        ),
        vatCodeIds: quote.lines.flatMap((line) => (line.vatCodeId ? [line.vatCodeId] : [])),
      },
    })

    try {
      await Quotes.save(quote, {
        notes: data.notes ?? null,
        validityDays: data.validityDays ?? null,
        lines: data.lines,
      })
    } catch (error) {
      if (!(error instanceof QuoteNotEditableError)) throw error
      session.flash('error', i18n.t('flash.quoteNotEditable'))
      return response.redirect().toRoute('quotes.edit', { id: quote.id })
    }

    session.flash('success', i18n.t('flash.quoteSaved'))
    response.redirect().toRoute('quotes.edit', { id: quote.id })
  }

  /**
   * Imports the chosen lines of an accepted Quote as Charges, onto the Job
   * or one of its open Visits (ADR 0012).
   */
  async importLines({ params, request, response, session, auth, i18n }: HttpContext) {
    const quote = await Quote.findOrFail(params.id)
    const data = await request.validateUsing(quoteImportValidator)

    try {
      const charges = await Quotes.importLines(quote, data, auth.getUserOrFail())
      // Imported Items are planned, so committed: warn when short
      await flashWithStockWarning(
        { session, i18n },
        charges.flatMap((charge) => (charge.itemId ? [charge.itemId] : [])),
        i18n.t('flash.quoteLinesImported', { count: charges.length })
      )
      return response.redirect().toRoute('jobs.show', { id: quote.jobId })
    } catch (error) {
      if (!(error instanceof QuoteImportRefusedError)) throw error
      session.flash('error', i18n.t(`flash.quoteImportRefused.${error.reason}`))
      return response.redirect().toRoute('quotes.edit', { id: quote.id })
    }
  }

  /**
   * Marks the draft as sent to the Customer, freezing it (ADR 0013).
   */
  async send({ params, response, session, i18n }: HttpContext) {
    const quote = await Quote.findOrFail(params.id)
    try {
      await Quotes.send(quote)
    } catch (error) {
      if (!(error instanceof QuoteNotEditableError)) throw error
      session.flash('error', i18n.t('flash.quoteNotEditable'))
      return response.redirect().toRoute('quotes.edit', { id: quote.id })
    }
    session.flash('success', i18n.t('flash.quoteSent'))
    response.redirect().toRoute('quotes.edit', { id: quote.id })
  }

  async accept({ params, response, session, i18n }: HttpContext) {
    return this.decide(params.id, 'accept', { response, session, i18n })
  }

  async decline({ params, response, session, i18n }: HttpContext) {
    return this.decide(params.id, 'decline', { response, session, i18n })
  }

  async pdf({ params, response, logger, i18n }: HttpContext) {
    const quote = await loadQuote(params.id)

    try {
      const pdf = await new DocumentRenderer().renderPdf(await quoteDocument(quote, i18n))
      response.header('content-type', 'application/pdf')
      response.header(
        'content-disposition',
        `inline; filename="preventivo-${quote.number.replace('/', '-')}.pdf"`
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
    const quote = await Quote.findOrFail(id)
    try {
      await (decision === 'accept' ? Quotes.accept(quote) : Quotes.decline(quote))
    } catch (error) {
      if (!(error instanceof QuoteNotEditableError)) throw error
      session.flash('error', i18n.t('flash.quoteNotEditable'))
      return response.redirect().toRoute('quotes.edit', { id: quote.id })
    }

    session.flash(
      'success',
      i18n.t(decision === 'accept' ? 'flash.quoteAccepted' : 'flash.quoteDeclined')
    )
    response.redirect().toRoute('jobs.show', { id: quote.jobId })
  }
}

/**
 * A Quote with its Job (and the Job's Customer) and its lines in order.
 */
async function loadQuote(id: number) {
  return Quote.query()
    .where('id', id)
    .preload('job', (job) => job.preload('customer'))
    .preload('lines', (lines) => lines.orderBy('position').preload('item'))
    .firstOrFail()
}

/**
 * What the editor needs whether the Quote is new or not: the Job, and the
 * rates, call-out fee and VAT choices for its lines.
 */
async function pageProps(job: Job, quote: Quote | null, bouncer: HttpContext['bouncer']) {
  const rates = await LabourRate.query().whereNull('archived_at').orderBy('name')
  const settings = await CompanySettings.current()
  return {
    job: {
      id: job.id,
      number: job.number,
      title: job.title,
      status: job.status,
      customer: job.customer.displayName,
      customerId: job.customerId,
    },
    quote: null,
    // An Item on a line opens its preview, for those who may open the Item
    previewItems: await bouncer.allows('manageItems'),
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
  }
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
