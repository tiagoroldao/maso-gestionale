import Job from '#models/job'
import Jobs, { JobInvoicedError, JobNotEditableError } from '#services/jobs'
import Invoice from '#models/invoice'
import Customer from '#models/customer'
import { likePattern } from '#services/search'
import { jobSearchValidator, jobValidator } from '#validators/job'
import { jobRow } from '#services/job_rows'
import { WORK_COMPLETE_SQL } from '#services/job_status'
import { lineTotal, sumAmounts } from '#shared/money'
import { localDateTime } from '#services/dates'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

export default class JobsController {
  async index({ request, inertia }: HttpContext) {
    const { q, status, page = 1 } = await jobSearchValidator.validate(request.qs())

    const query = Job.query().preload('customer').preload('site').preload('visits')
    // Work Complete is derived from the Visits, so it's a condition, not a column
    if (!status) query.whereNot('status', 'cancelled')
    else if (status === 'work_complete') query.whereRaw(WORK_COMPLETE_SQL)
    else if (status === 'in_progress')
      query.where('status', status).whereRaw(`NOT (${WORK_COMPLETE_SQL})`)
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
      jobs: results.all().map(jobRow),
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
    const data = await request.validateUsing(jobValidator)

    const job = await Jobs.create({
      customerId: data.customerId,
      siteId: data.siteId,
      kind: data.kind,
      workCategory: data.workCategory,
      title: data.title,
      description: data.description,
    })

    session.flash('success', i18n.t('flash.jobCreated', { number: job.number }))
    response.redirect().toRoute('jobs.show', { id: job.id })
  }

  async show({ params, inertia }: HttpContext) {
    const job = await Job.query()
      .where('id', params.id)
      .preload('customer')
      .preload('site')
      .preload('visits', (visits) =>
        visits
          .preload('technicians')
          .preload('fieldNotes', (notes) => notes.preload('author').orderBy('createdAt'))
          .preload('photos', (photos) => photos.orderBy('createdAt'))
          .preload('hours', (hours) => hours.preload('labourRate'))
          .preload('items', (items) => items.preload('item'))
          .orderBy('startsAt')
      )
      .firstOrFail()

    // Time and materials recorded so far, at the prices when recorded
    const amounts = job.visits.flatMap((visit) => [
      ...visit.hours.map((hour) => lineTotal(hour.hours, hour.unitPrice)),
      ...visit.items.map((line) => lineTotal(line.quantity, line.unitPrice)),
    ])

    const invoices = await Invoice.query().where('jobId', job.id).preload('lines').orderBy('id')
    const quote = await job.related('quote').query().first()

    return inertia.render('jobs/show', {
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.formattedNumber,
        status: invoice.status,
        total: invoice.totals.total,
      })),
      // Once per Job (until billed lines are tracked, #75), never cancelled
      canInvoice:
        job.status !== 'cancelled' &&
        invoices.length === 0 &&
        (job.kind === 'quoted' ? quote?.status === 'accepted' : amounts.length > 0),
      timeAndMaterials: { total: sumAmounts(amounts), lines: amounts.length },
      job: {
        ...jobRow(job),
        description: job.description,
        cancelledAt: job.cancelledAt?.toISODate() ?? null,
      },
      visits: job.visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
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

    const hasQuote = Boolean(await job.related('quote').query().first())

    return inertia.render('jobs/form', {
      job: {
        id: job.id,
        number: job.number,
        kind: job.kind,
        status: job.status,
        kindLocked: job.status !== 'open' || hasQuote,
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
    const data = await request.validateUsing(jobValidator)
    try {
      const job = await Jobs.update(params.id, data)
      session.flash('success', i18n.t('flash.jobSaved', { number: job.number }))
    } catch (error) {
      if (error instanceof JobNotEditableError) {
        session.flash('error', i18n.t('flash.jobNotEditable'))
      } else if (error instanceof JobInvoicedError) {
        session.flash('error', i18n.t('flash.jobCustomerInvoiced'))
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
      if (!(error instanceof JobInvoicedError)) throw error
      session.flash('error', i18n.t('flash.jobInvoiced'))
    }
    response.redirect().toRoute('jobs.show', { id: params.id })
  }
}
