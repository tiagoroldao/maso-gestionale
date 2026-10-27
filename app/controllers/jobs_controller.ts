import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import Customer from '#models/customer'
import Site from '#models/site'
import { nextJobSequence } from '#services/job_numbers'
import { likePattern } from '#services/search'
import { jobSearchValidator, jobValidator } from '#validators/job'
import { jobRow } from '#services/job_rows'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

export default class JobsController {
  async index({ request, inertia }: HttpContext) {
    const { q, status, page = 1 } = await jobSearchValidator.validate(request.qs())

    const query = Job.query().preload('customer').preload('site')
    if (!status) query.whereNot('status', 'cancelled')
    else if (status !== 'all') query.where('status', status)
    if (q) {
      const pattern = likePattern(q)
      query.where((builder) => {
        builder
          .whereILike('title', pattern)
          .orWhereRaw(`concat(year, '/', lpad(sequence::text, 4, '0')) ilike ?`, [pattern])
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
    const siteId = Number(request.qs().siteId) || null
    const customer = customerId ? await Customer.find(customerId) : null
    const site = siteId ? await Site.find(siteId) : null

    return inertia.render('jobs/form', {
      job: null,
      customer: customer ? { id: customer.id, displayName: customer.displayName } : null,
      site: site ? { id: site.id, summary: site.summary } : null,
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(jobValidator)

    const job = await db.transaction(async (trx) => {
      const year = DateTime.now().year
      return Job.create(
        {
          year,
          sequence: await nextJobSequence(trx, year),
          customerId: data.customerId,
          siteId: data.siteId ?? null,
          kind: data.kind,
          status: 'open',
          title: data.title,
          description: data.description ?? null,
        },
        { client: trx }
      )
    })

    session.flash('success', i18n.t('flash.jobCreated', { number: job.number }))
    response.redirect().toRoute('jobs.show', { id: job.id })
  }

  async show({ params, inertia }: HttpContext) {
    const job = await Job.query()
      .where('id', params.id)
      .preload('customer')
      .preload('site')
      .firstOrFail()

    return inertia.render('jobs/show', {
      job: {
        ...jobRow(job),
        description: job.description,
        cancelledAt: job.cancelledAt?.toISODate() ?? null,
      },
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
        kind: job.kind,
        status: job.status,
        title: job.title,
        description: job.description,
      },
      customer: { id: job.customer.id, displayName: job.customer.displayName },
      site: job.site ? { id: job.site.id, summary: job.site.summary } : null,
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(jobValidator)

    job.merge({
      customerId: data.customerId,
      siteId: data.siteId ?? null,
      title: data.title,
      description: data.description ?? null,
    })
    // The kind decides how the Job is invoiced, so it can only change while open
    if (job.status === 'open') job.kind = data.kind
    await job.save()

    session.flash('success', i18n.t('flash.jobSaved', { number: job.number }))
    response.redirect().toRoute('jobs.show', { id: job.id })
  }

  async cancel({ params, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)

    if (job.status !== 'cancelled') {
      job.status = 'cancelled'
      job.cancelledAt = DateTime.now()
      await job.save()
    }

    session.flash('success', i18n.t('flash.jobCancelled', { number: job.number }))
    response.redirect().toRoute('jobs.show', { id: job.id })
  }
}
