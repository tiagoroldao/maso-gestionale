import Job from '#models/job'
import { hasBillableWork, isClosedVisit } from '#shared/visits'
import { isVisitBilled, type ChargeState } from '#shared/charges'
import Jobs, {
  JobClosedError,
  JobInvoicedError,
  JobNotEditableError,
  type JobLeftovers,
} from '#services/jobs'
import Invoice from '#models/invoice'
import Invoices from '#services/invoices'
import Quotes from '#services/quotes'
import { advanceState } from '#shared/advances'
import Charge from '#models/charge'
import CompanySettings from '#models/company_settings'
import { ArchivedRecordError } from '#services/archiving'
import Customer from '#models/customer'
import { likePattern } from '#services/search'
import { jobSearchValidator, jobValidator } from '#validators/job'
import { jobRow } from '#services/job_rows'
import { INVOICED_SQL, READY_TO_CLOSE_SQL, WORK_COMPLETE_SQL } from '#services/job_status'
import { ACTIVE_JOB_STATUSES } from '#shared/jobs'
import { lineTotal, sumAmounts } from '#shared/money'
import { localDateTime } from '#services/dates'
import { quoteNumber } from '#shared/quotes'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

export default class JobsController {
  async index({ request, inertia }: HttpContext) {
    const { q, status, page = 1 } = await jobSearchValidator.validate(request.qs())

    const query = Job.query()
      .withScopes((scopes) => scopes.withBillingState())
      .preload('customer')
      .preload('site')
      .preload('visits')
      .preload('invoices', (invoices) => invoices.preload('payments'))
      .preload('quotes', (quotes) => quotes.orderBy('sequence'))
    // The active list (the default) leaves out closed and cancelled Jobs;
    // the indicators (ADR 0015) are derived, so they're conditions on the
    // active Jobs, not columns
    const active = () => query.whereIn('status', [...ACTIVE_JOB_STATUSES])
    if (!status) active()
    else if (status === 'work_complete') active().whereRaw(WORK_COMPLETE_SQL)
    else if (status === 'invoiced') active().whereRaw(INVOICED_SQL)
    else if (status === 'ready_to_close') active().whereRaw(READY_TO_CLOSE_SQL)
    // By their Quotes (ADR 0013): one waiting for the Customer (never on a
    // closed or cancelled Job, where no answer is recorded), or one accepted
    else if (status === 'quote_sent')
      active().whereHas('quotes', (quotes) => quotes.where('status', 'sent'))
    else if (status === 'quote_accepted')
      query.whereHas('quotes', (quotes) => quotes.where('status', 'accepted'))
    else if (status !== 'all') query.where('status', status)
    if (q) {
      const pattern = likePattern(q)
      query.where((builder) => {
        builder
          .whereILike('title', pattern)
          // Matches "2026/0007" as displayed, including sequences past 9999
          .orWhereRaw(
            `concat(year, '/', lpad(sequence::text, greatest(4, length(sequence::text)), '0')) ilike ?`,
            [pattern]
          )
          .orWhereHas('customer', (customer) => {
            customer
              .whereILike('name', pattern)
              .orWhereRaw(`concat_ws(' ', first_name, last_name) ilike ?`, [pattern])
              .orWhereRaw(`concat_ws(' ', last_name, first_name) ilike ?`, [pattern])
          })
      })
    }
    const results = await query
      .orderBy([
        { column: 'year', order: 'desc' },
        { column: 'sequence', order: 'desc' },
      ])
      .paginate(page, PER_PAGE)

    return inertia.render('jobs/index', {
      q: q ?? '',
      status: status ?? 'active',
      jobs: results.all().map((job) => ({
        ...jobRow(job),
        quotes: job.quotes.map((quote) => ({
          number: quoteNumber(job.number, quote.sequence),
          status: quote.status,
        })),
      })),
      pagination: {
        currentPage: results.currentPage,
        lastPage: results.lastPage,
        total: results.total,
      },
    })
  }

  async create({ request, inertia }: HttpContext) {
    const customerId = Number(request.qs().customerId) || null
    const customer = customerId ? await Customer.find(customerId) : null

    return inertia.render('jobs/form', {
      job: null,
      customer: customer ? { id: customer.id, displayName: customer.displayName } : null,
      site: null,
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(jobValidator, { meta: {} })

    let job
    try {
      job = await Jobs.create({
        customerId: data.customerId,
        siteId: data.siteId,
        workCategory: data.workCategory,
        title: data.title,
        description: data.description,
      })
    } catch (error) {
      if (!(error instanceof ArchivedRecordError)) throw error
      session.flash('error', i18n.t('flash.archivedRecord'))
      return response.redirect().back()
    }

    session.flash('success', i18n.t('flash.jobCreated', { number: job.number }))
    response.redirect().toRoute('jobs.show', { id: job.id })
  }

  async show({ params, inertia }: HttpContext) {
    const job = await Job.query()
      .withScopes((scopes) => scopes.withBillingState())
      .where('id', params.id)
      .preload('customer')
      .preload('site')
      .preload('invoices', (invoices) => invoices.preload('payments'))
      .preload('visits', (visits) =>
        visits
          .preload('technicians')
          .preload('fieldNotes', (notes) => notes.preload('author').orderBy('createdAt'))
          .preload('photos', (photos) => photos.orderBy('createdAt'))
          .orderBy('startsAt')
      )
      .firstOrFail()

    const charges = await Charge.query()
      .where('jobId', job.id)
      .preload('events', (events) => events.orderBy('id'))
      .preload('invoiceLines', (lines) => lines.preload('invoice'))
      .preload('item')
      .preload('technician')
      .orderBy(['createdAt', 'id'])
    // What a Charge bills: the amount its Invoice billed, otherwise what
    // Office set to bill
    const amountOf = (charge: Charge) =>
      charge.billing?.amount ?? lineTotal(charge.billQuantity, charge.unitPrice)
    // What is billable so far, and where it stands
    const work = charges
      .filter((charge) => charge.state !== 'not_billable')
      .map((charge) => ({ visitId: charge.visitId, amount: amountOf(charge), state: charge.state }))
    const amounts = work.map((line) => line.amount)
    const sumOf = (state: ChargeState) =>
      sumAmounts(work.filter((line) => line.state === state).map((line) => line.amount))

    const settings = await CompanySettings.current()
    const invoices = await Invoice.query().where('jobId', job.id).preload('lines').orderBy('id')
    const quotes = await job.related('quotes').query().preload('lines').orderBy('sequence')
    // Advance Invoices don't count as a draft from the Job's Charges
    const ownInvoices = invoices.filter((invoice) => !invoice.advance)
    const advances = await Invoices.advancesOf(undefined, job.id)
    const deductions = new Map(advances.map(({ advance, deducted }) => [advance.id, deducted]))

    return inertia.render('jobs/show', {
      // A Job may have several Quotes, written at any time while it isn't
      // cancelled (ADR 0013)
      quotes: quotes.map((quote) => ({
        id: quote.id,
        number: quoteNumber(job.number, quote.sequence),
        status: quote.status,
        total: quote.totals.total,
      })),
      canWriteQuote: Quotes.canWrite(job),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.formattedNumber,
        status: invoice.status,
        total: invoice.totals.total,
        advance: invoice.advance,
        // An issued advance: how much issued Invoices took back (ADR 0011)
        deduction: deductions.has(invoice.id)
          ? {
              deducted: deductions.get(invoice.id)!,
              state: advanceState(invoice.total!, deductions.get(invoice.id)!),
            }
          : null,
      })),
      // Every Job invoices from its Charges, Quote or not (ADR 0012), even
      // once closed or cancelled (#111), while some is to bill and no draft
      // waits
      canInvoice:
        !ownInvoices.some((invoice) => invoice.status === 'draft') &&
        (hasBillableWork(
          job.visits.map((visit) => ({
            status: visit.status,
            unbilledLines: work.filter(
              (line) => line.visitId === visit.id && line.state === 'to_bill'
            ).length,
          }))
        ) ||
          // Charges on the Job itself are billable at once
          work.some((line) => line.visitId === null && line.state === 'to_bill')),
      // An advance is for work to come
      canInvoiceAdvance: job.isActive,
      // What closing would leave behind, shown as a warning (ADR 0015)
      leftToClose: job.isActive ? await Jobs.leftToClose(job.id) : null,
      // Taxable amounts: what issued Invoices billed (deductions net out the
      // advances) against the work recorded, and the sum of the accepted
      // Quotes for comparison only, since they don't bind the bill (ADR
      // 0012, 0013)
      invoicedSoFar: {
        amount: sumAmounts(
          invoices
            .filter((invoice) => invoice.status !== 'draft')
            .map((invoice) => invoice.totals.taxable)
        ),
        of: sumAmounts(amounts),
        quoted: quotes.some((quote) => quote.status === 'accepted')
          ? sumAmounts(
              quotes.filter((quote) => quote.status === 'accepted').map((quote) => quote.taxable)
            )
          : null,
      },
      timeAndMaterials: {
        total: sumAmounts(amounts),
        billed: sumOf('billed'),
        inDraft: sumOf('in_draft'),
        lines: amounts.length,
      },
      callOutFee: settings?.callOutFee ?? null,
      charges: charges.map((charge) => ({
        id: charge.id,
        visitId: charge.visitId,
        description: charge.description,
        unit: charge.billUnit,
        quantity: charge.billQuantity,
        unitPrice: charge.unitPrice,
        amount: amountOf(charge),
        state: charge.state,
      })),
      job: {
        ...jobRow(job),
        description: job.description,
        cancelledAt: job.cancelledAt?.toISODate() ?? null,
        closedAt: job.closedAt?.toISODate() ?? null,
      },
      visits: job.visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
        survey: visit.survey,
        billed: isVisitBilled(
          isClosedVisit(visit.status),
          charges.filter((charge) => charge.visitId === visit.id).map((charge) => charge.state)
        ),
        technicians: visit.technicians.map((technician) => technician.fullName ?? technician.email),
        notes: visit.fieldNotes.map((note) => ({
          id: note.id,
          body: note.body,
          author: note.author?.fullName ?? note.author?.email ?? null,
        })),
        photoIds: visit.photos.map((photo) => photo.id),
      })),
    })
  }

  async edit({ params, inertia }: HttpContext) {
    const job = await Job.query()
      .where('id', params.id)
      .preload('customer')
      .preload('site')
      .firstOrFail()

    return inertia.render('jobs/form', {
      job: {
        id: job.id,
        number: job.number,
        status: job.status,
        workCategory: job.workCategory,
        title: job.title,
        description: job.description,
      },
      customer: { id: job.customer.id, displayName: job.customer.displayName },
      site: job.site ? { id: job.site.id, summary: job.site.summary } : null,
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    // A cancelled Job is refused before its form is even checked
    const current = await Job.findOrFail(params.id)
    if (current.status === 'cancelled') {
      session.flash('error', i18n.t('flash.jobNotEditable'))
      return response.redirect().toRoute('jobs.show', { id: current.id })
    }
    const data = await request.validateUsing(jobValidator, {
      meta: { customerId: current.customerId, siteId: current.siteId ?? undefined },
    })
    try {
      const updated = await Jobs.update(params.id, data)
      session.flash('success', i18n.t('flash.jobSaved', { number: updated.number }))
    } catch (error) {
      if (error instanceof JobNotEditableError) {
        session.flash('error', i18n.t('flash.jobNotEditable'))
      } else if (error instanceof JobInvoicedError) {
        session.flash('error', i18n.t('flash.jobCustomerInvoiced'))
      } else if (error instanceof ArchivedRecordError) {
        session.flash('error', i18n.t('flash.archivedRecord'))
      } else {
        throw error
      }
    }
    response.redirect().toRoute('jobs.show', { id: params.id })
  }

  async cancel({ params, response, session, i18n }: HttpContext) {
    try {
      const job = await Jobs.cancel(params.id)
      session.flash('success', i18n.t('flash.jobCancelled', { number: job.number }))
    } catch (error) {
      if (error instanceof JobInvoicedError) session.flash('error', i18n.t('flash.jobInvoiced'))
      else if (error instanceof JobClosedError) session.flash('error', i18n.t('flash.jobClosed'))
      else throw error
    }
    response.redirect().toRoute('jobs.show', { id: params.id })
  }

  /**
   * Closes the Job by hand (ADR 0015): never refused for what is left,
   * which turns the confirmation into a warning listing it.
   */
  async close({ params, response, session, i18n }: HttpContext) {
    try {
      const { job, left } = await Jobs.close(params.id)
      const parts = leftovers(left).map(([key, count]) =>
        i18n.t(`ui.jobs.leftToClose.${key}`, { count })
      )
      if (parts.length) {
        session.flash(
          'warning',
          i18n.t('flash.jobClosedWithLeft', { number: job.number, left: parts.join(', ') })
        )
      } else {
        session.flash('success', i18n.t('flash.jobClosedNow', { number: job.number }))
      }
    } catch (error) {
      if (!(error instanceof JobNotEditableError)) throw error
      session.flash('error', i18n.t('flash.jobNotEditable'))
    }
    response.redirect().toRoute('jobs.show', { id: params.id })
  }

  /**
   * Reopens a closed Job when more work turns up.
   */
  async reopen({ params, response, session, i18n }: HttpContext) {
    try {
      const job = await Jobs.reopen(params.id)
      session.flash('success', i18n.t('flash.jobReopened', { number: job.number }))
    } catch (error) {
      if (error instanceof JobNotEditableError) {
        session.flash('error', i18n.t('flash.jobNotEditable'))
      } else if (error instanceof ArchivedRecordError) {
        session.flash('error', i18n.t('flash.jobReopenArchived'))
      } else {
        throw error
      }
    }
    response.redirect().toRoute('jobs.show', { id: params.id })
  }
}

/**
 * The things left on a Job that closing warns about, with their counts.
 */
function leftovers(left: JobLeftovers) {
  return Object.entries(left).filter(([, count]) => count > 0)
}
