import { DateTime } from 'luxon'
import Job from '#models/job'
import User from '#models/user'
import Visit from '#models/visit'
import Scheduling, { JobNotSchedulableError, VisitNotMovableError } from '#services/scheduling'
import { moveVisitValidator, scheduleValidator, visitValidator } from '#validators/visit'
import { localDateTime } from '#services/dates'
import type { HttpContext } from '@adonisjs/core/http'

async function technicians() {
  const users = await User.query()
    .where('role', 'technician')
    .where('isActive', true)
    .orderBy('fullName')
  return users.map((user) => ({ id: user.id, name: user.fullName ?? user.email }))
}

/**
 * Planning Visits for Jobs, and the calendar where Office moves them.
 */
export default class VisitsController {
  async create({ params, inertia }: HttpContext) {
    const job = await Job.query().where('id', params.id).preload('customer').firstOrFail()

    return inertia.render('visits/create', {
      job: { id: job.id, number: job.number, title: job.title, customer: job.customer.displayName },
      technicians: await technicians(),
    })
  }

  async store({ params, request, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(visitValidator)

    const startsAt = DateTime.fromISO(`${data.date.toISODate()}T${data.startTime}`)
    try {
      await Scheduling.plan(job, {
        startsAt,
        endsAt: startsAt.plus({ minutes: data.durationMinutes }),
        technicianIds: data.technicianIds,
        notes: data.notes ?? null,
      })
    } catch (error) {
      if (!(error instanceof JobNotSchedulableError)) throw error
      session.flash('error', i18n.t('flash.jobNotSchedulable'))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    }

    session.flash('success', i18n.t('flash.visitPlanned'))
    response
      .redirect()
      .toRoute('visits.schedule', {}, { qs: { date: startsAt.toFormat('yyyy-MM-dd') } })
  }

  /**
   * The calendar: one lane per active Technician, for a day or a week
   * (Monday to Sunday).
   */
  async schedule({ request, inertia }: HttpContext) {
    const { date, view = 'day' } = await scheduleValidator.validate(request.qs())
    const day = (date ?? DateTime.now()).startOf('day')
    const from = view === 'week' ? day.startOf('week') : day
    const to = view === 'week' ? from.plus({ weeks: 1 }) : from.plus({ days: 1 })

    const visits = await Visit.query()
      .where('startsAt', '<', to.toJSDate())
      .where('endsAt', '>', from.toJSDate())
      // Abandoned work leaves the Agenda; the Visits stay in the Job's history
      .whereHas('job', (job) => job.whereNot('status', 'cancelled'))
      .preload('technicians')
      .preload('job', (job) => job.preload('customer').preload('site'))
      .orderBy('startsAt')

    return inertia.render('visits/schedule', {
      view,
      date: day.toFormat('yyyy-MM-dd'),
      from: from.toFormat('yyyy-MM-dd'),
      days: Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) =>
        from.plus({ days: i }).toFormat('yyyy-MM-dd')
      ),
      technicians: await technicians(),
      visits: visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
        technicianIds: visit.technicians.map((technician) => technician.id),
        job: {
          id: visit.job.id,
          number: visit.job.number,
          title: visit.job.title,
          customer: visit.job.customer.displayName,
          site: visit.job.site?.summary ?? null,
        },
      })),
    })
  }

  async move({ params, request, response, session, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    const data = await request.validateUsing(moveVisitValidator)

    try {
      await Scheduling.move(visit, {
        startsAt: data.startsAt,
        fromTechnicianId: data.fromTechnicianId,
        toTechnicianId: data.toTechnicianId,
      })
    } catch (error) {
      if (!(error instanceof VisitNotMovableError)) throw error
      session.flash('error', i18n.t('flash.visitNotMovable'))
      return response.redirect().back()
    }

    session.flash('success', i18n.t('flash.visitMoved'))
    response.redirect().back()
  }
}
