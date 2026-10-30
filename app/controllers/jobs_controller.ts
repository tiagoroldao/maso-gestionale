import Big from 'big.js'
import Job from '#models/job'
import { closableByOffice, hasBillableWork, isCancelledVisit } from '#shared/visits'
import { isDraftable, isVisitBilled, type ChargeState } from '#shared/charges'
import Jobs, {
  JobClosedError,
  JobInvoicedError,
  JobNotEditableError,
  type JobLeftovers,
} from '#services/jobs'
import Invoice from '#models/invoice'
import Invoices from '#services/invoices'
import Quotes from '#services/quotes'
import IssuedDocuments from '#services/issued_documents'
import { advanceState } from '#shared/advances'
import Charge from '#models/charge'
import CompanySettings from '#models/company_settings'
import { ArchivedRecordError } from '#services/archiving'
import Customer from '#models/customer'
import Site from '#models/site'
import { likePattern } from '#services/search'
import { jobSearchValidator, jobValidator } from '#validators/job'
import { jobRow } from '#services/job_rows'
import { jobActions } from '#services/job_actions'
import { chargeSummary, visitProgress, type SummaryCharge } from '#services/job_summary'
import { INVOICED_SQL, READY_TO_CLOSE_SQL, WORK_COMPLETE_SQL } from '#services/job_status'
import { ACTIVE_JOB_STATUSES } from '#shared/jobs'
import { lineTotal, sumAmounts } from '#shared/money'
import { localDateTime } from '#services/dates'
import { quoteNumber } from '#shared/quotes'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

export default class JobsController {
  async index({ request, inertia }: HttpContext) {
    const {
      q,
      status,
      customerId,
      siteId,
      page = 1,
    } = await jobSearchValidator.validate(request.qs())
    // Linked from a Customer's or Site's page, which shows its newest Jobs only
    const ofCustomer = customerId ? await Customer.findOrFail(customerId) : null
    const ofSite = siteId ? await Site.findOrFail(siteId) : null

    const query = Job.query()
      .withScopes((scopes) => scopes.withBillingState())
      .preload('customer')
      .preload('site')
      .preload('visits')
      .preload('invoices', (invoices) => invoices.preload('payments').preload('creditNotes'))
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
    if (ofCustomer) query.where('customerId', ofCustomer.id)
    if (ofSite) query.where('siteId', ofSite.id)
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
      customer: ofCustomer ? { id: ofCustomer.id, displayName: ofCustomer.displayName } : null,
      site: ofSite ? { id: ofSite.id, summary: ofSite.summary } : null,
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

  async show({ params, inertia, bouncer, i18n }: HttpContext) {
    const job = await Job.query()
      .withScopes((scopes) => scopes.withBillingState())
      .where('id', params.id)
      .preload('customer')
      .preload('site')
      .preload('invoices', (invoices) => invoices.preload('payments').preload('creditNotes'))
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
      .preload('labourRate')
      .orderBy(['createdAt', 'id'])
    // What a Charge bills: the amount its Invoice billed, otherwise what
    // Office set to bill
    const amountOf = (charge: Charge) =>
      charge.billing?.amount ?? lineTotal(charge.billQuantity, charge.unitPrice)
    // What is billable so far, and where it stands: not what Office marked
    // not billable, nor what Credit Notes credited (ADR 0014), nor work not
    // done (ADR 0016)
    const work = charges
      .filter(
        (charge) =>
          charge.state !== 'not_billable' &&
          charge.state !== 'credited' &&
          charge.workState !== 'not_done'
      )
      .map((charge) => ({
        visitId: charge.visitId,
        amount: amountOf(charge),
        state: charge.state,
        draftable: isDraftable(charge.state, charge.workState),
      }))
    const amounts = work.map((line) => line.amount)
    const sumOf = (state: ChargeState) =>
      sumAmounts(work.filter((line) => line.state === state).map((line) => line.amount))

    // An Item's Charge opens the Item's preview, for those who may open the Item
    const previewItems = await bouncer.allows('manageItems')
    const settings = await CompanySettings.current()
    const invoices = await Invoice.query().where('jobId', job.id).preload('lines').orderBy('id')
    const quotes = await job.related('quotes').query().preload('lines').orderBy('sequence')
    // Advance Invoices don't count as a draft from the Job's Charges
    const ownInvoices = invoices.filter((invoice) => !invoice.advance)
    const issuedAdvances = await Invoices.advancesOf(undefined, job.id)
    const advances = new Map(issuedAdvances.map((entry) => [entry.advance.id, entry]))
    // Each Invoice's Credit Notes, drafts included (ADR 0014)
    const creditNotes = invoices.length
      ? await Invoice.query()
          .whereIn(
            'creditsInvoiceId',
            invoices.map((invoice) => invoice.id)
          )
          .preload('lines')
          .orderBy('id')
      : []
    const issued = (invoice: Invoice) => invoice.status !== 'draft'
    const visits = job.visits.map((visit) => ({
      id: visit.id,
      status: visit.status,
      startsAt: localDateTime(visit.startsAt),
      endsAt: localDateTime(visit.endsAt),
    }))
    const progress = visitProgress(visits, job.isActive)
    const draftWaiting = ownInvoices.some((invoice) => invoice.status === 'draft')
    // Every Job invoices from its Charges, Quote or not (ADR 0012), even
    // once closed or cancelled (#111), while some is to bill and no draft
    // waits
    const canInvoice =
      !draftWaiting &&
      (hasBillableWork(
        job.visits.map((visit) => ({
          status: visit.status,
          unbilledLines: work.filter((line) => line.visitId === visit.id && line.draftable).length,
        }))
      ) ||
        // Done Charges on the Job itself are billable at once
        work.some((line) => line.visitId === null && line.draftable))

    return inertia.render('jobs/show', {
      // The page's header actions, for the user's role and the Job's status
      actions: jobActions(
        {
          job,
          canInvoice,
          draftWaiting,
          canWriteQuote: Quotes.canWrite(job),
          visits,
          can: { invoices: await bouncer.allows('manageInvoices') },
        },
        i18n
      ),
      // A Job may have several Quotes, written at any time while it isn't
      // cancelled (ADR 0013)
      quotes: quotes.map((quote) => ({
        id: quote.id,
        number: quoteNumber(job.number, quote.sequence),
        status: quote.status,
        total: quote.totals.total,
      })),
      canWriteQuote: Quotes.canWrite(job),
      // Office adds costs while the Job takes new work (ADR 0015)
      canAddCharge: job.isActive,
      invoices: invoices.map((invoice) => {
        const advance = advances.get(invoice.id)
        return {
          id: invoice.id,
          number: invoice.formattedNumber,
          status: invoice.status,
          total: invoice.totals.total,
          advance: invoice.advance,
          // A Legacy Invoice the previous software issued (#27)
          legacy: invoice.isLegacy,
          // An issued advance: how much issued Invoices deducted and Credit
          // Notes credited of it (ADR 0011, 0014)
          deduction: advance
            ? {
                deducted: advance.deducted,
                credited: advance.credited,
                state: advanceState(invoice.total!, advance.deducted, advance.credited),
              }
            : null,
          creditNotes: creditNotes
            .filter((note) => note.creditsInvoiceId === invoice.id)
            .map((note) => ({
              id: note.id,
              number: note.formattedNumber,
              status: note.status,
              total: note.totals.total,
            })),
        }
      }),
      canInvoice,
      // An advance is for work to come
      canInvoiceAdvance: job.isActive,
      // What closing would leave behind, shown as a warning (ADR 0015)
      leftToClose: job.isActive ? await Jobs.leftToClose(job.id) : null,
      // Taxable amounts: what issued Invoices billed (deductions net out the
      // advances; a Legacy Invoice's taxable as printed, #27), less what
      // Credit Notes past draft credited (ADR 0014),
      // against the work recorded, and the sum of the accepted Quotes for
      // comparison only, since they don't bind the bill (ADR 0012, 0013)
      invoicedSoFar: {
        amount: sumAmounts([
          ...invoices.filter(issued).map((invoice) => invoice.totals.taxable),
          ...creditNotes
            .filter(issued)
            .map((note) => new Big(note.totals.taxable).neg().toFixed(2)),
        ]),
        of: sumAmounts(amounts),
        quoted: quotes.some((quote) => quote.status === 'accepted')
          ? sumAmounts(
              quotes
                .filter((quote) => quote.status === 'accepted')
                .map((quote) => quote.totals.taxable)
            )
          : null,
      },
      timeAndMaterials: {
        total: sumAmounts(amounts),
        // What a draft would bill now: done work not yet in an Invoice, not
        // what is still planned (ADR 0016)
        toBill: sumAmounts(work.filter((line) => line.draftable).map((line) => line.amount)),
        billed: sumOf('billed'),
        inDraft: sumOf('in_draft'),
        lines: amounts.length,
      },
      callOutFee: settings?.callOutFee ?? null,
      // For Jobs with many Visits (#178): how far the Visits have got, and
      // the hours and Items across them and the Job itself, by work state
      progress: {
        done: progress.done,
        total: progress.total,
        cancelled: progress.cancelled,
        next: progress.next && { startsAt: progress.next.startsAt, endsAt: progress.next.endsAt },
      },
      // The Job's work report (#180) is issued from these templates, and
      // listed with the Job's other Issued Documents
      workReportTemplates: await IssuedDocuments.workReportTemplates(),
      issuedDocuments: await IssuedDocuments.history({ jobId: job.id }),
      summary: chargeSummary(
        charges.map((charge) => summaryCharge(charge)),
        job.visits.map((visit) => visit.id)
      ),
      charges: charges.map((charge) => ({
        id: charge.id,
        visitId: charge.visitId,
        description: charge.description,
        itemId: previewItems && charge.kind === 'item' ? charge.itemId : null,
        unit: charge.billUnit,
        quantity: charge.billQuantity,
        unitPrice: charge.unitPrice,
        amount: amountOf(charge),
        state: charge.state,
        workState: charge.workState,
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
        // Left open when the Job was cancelled: Office marks it done (#153)
        closableByOffice: closableByOffice(job.status, visit.status),
        // A cancelled Visit has nothing to bill, but nothing was billed
        // either: its status says enough
        billed:
          !isCancelledVisit(visit.status) &&
          isVisitBilled(
            visit.status,
            charges
              .filter((charge) => charge.visitId === visit.id)
              .map((charge) => ({ state: charge.state, work: charge.workState }))
          ),
        // Its Charges, for the review when Office closes it (ADR 0016)
        charges: charges
          .filter((charge) => charge.visitId === visit.id)
          .map((charge) => ({ id: charge.id, description: charge.description })),
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

  /**
   * Cancels the Job. Visits still open never stop it (#153): the page's
   * confirmation lists them, and the flash warns that they wait for Office
   * to mark them done.
   */
  async cancel({ params, response, session, i18n }: HttpContext) {
    try {
      const { job, openVisits } = await Jobs.cancel(Number(params.id))
      if (openVisits) {
        session.flash(
          'warning',
          i18n.t('flash.jobCancelledWithOpenVisits', { number: job.number, count: openVisits })
        )
      } else {
        session.flash('success', i18n.t('flash.jobCancelled', { number: job.number }))
      }
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
      const { job, left } = await Jobs.close(Number(params.id))
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
      const job = await Jobs.reopen(Number(params.id))
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
 * The Charge as the Job's Charges summary reads it (needs `events`,
 * `item`, `technician` and `labourRate` preloaded).
 */
function summaryCharge(charge: Charge): SummaryCharge {
  const common = { visitId: charge.visitId, quantity: charge.quantity, work: charge.workState }
  if (charge.kind === 'labour') {
    return {
      ...common,
      kind: 'labour',
      technicianId: charge.userId,
      worker: charge.worker,
      labourRateId: charge.labourRateId,
      labourRate: charge.labourRate?.name ?? null,
    }
  }
  if (charge.kind === 'item') {
    return {
      ...common,
      kind: 'item',
      itemId: charge.itemId!,
      item: charge.item.description,
      unit: charge.item.unit,
    }
  }
  return { ...common, kind: 'other' }
}

/**
 * The things left on a Job that closing warns about, with their counts.
 */
function leftovers(left: JobLeftovers) {
  return Object.entries(left).filter(([, count]) => count > 0)
}
