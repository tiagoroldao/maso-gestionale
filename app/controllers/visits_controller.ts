import { DateTime } from 'luxon'
import Job from '#models/job'
import User from '#models/user'
import Visit from '#models/visit'
import Scheduling, {
  JobNotSchedulableError,
  TechnicianHasHoursError,
  VisitHasWorkError,
  VisitNotMovableError,
} from '#services/scheduling'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'
import {
  editVisitValidator,
  moveVisitValidator,
  scheduleValidator,
  visitValidator,
} from '#validators/visit'
import { localDateTime } from '#services/dates'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Active Technicians, plus `extra` ones (e.g. deactivated since but still
 * on Visits being shown), marked inactive.
 */
async function technicians(extra: number[] = []) {
  const users = await User.query()
    .where((q) => q.where('role', 'technician').where('isActive', true))
    // Anyone already on a Visit keeps their place, even if since deactivated
    // or no longer a Technician
    .orWhereIn('id', extra)
    .orderBy('fullName')
  return users.map((user) => ({
    id: user.id,
    name: user.fullName ?? user.email,
    active: user.isActive,
  }))
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
      visit: null,
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
   * The calendar: one lane per active Technician (plus deactivated ones
   * with Visits in view), for a day or a week
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
      // Lanes for every active Technician, and for anyone else (deactivated,
      // or no longer a Technician) still on a Visit in view, so no Visit
      // disappears
      technicians: await technicians(
        visits.flatMap((visit) => visit.technicians.map((technician) => technician.id))
      ),
      // No lane to sit in: listed apart, so they can be given a team
      unassigned: visits
        .filter((visit) => visit.technicians.length === 0)
        .map((visit) => ({
          id: visit.id,
          startsAt: localDateTime(visit.startsAt),
          endsAt: localDateTime(visit.endsAt),
          job: { number: visit.job.number, customer: visit.job.customer.displayName },
        })),
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

  async edit({ params, inertia }: HttpContext) {
    const visit = await Visit.query()
      .where('id', params.id)
      .preload('technicians')
      .preload('job', (job) => job.preload('customer'))
      .firstOrFail()
    const ids = visit.technicians.map((technician) => technician.id)

    return inertia.render('visits/create', {
      job: {
        id: visit.job.id,
        number: visit.job.number,
        title: visit.job.title,
        customer: visit.job.customer.displayName,
      },
      technicians: await technicians(ids),
      visit: {
        id: visit.id,
        date: visit.startsAt.toISODate()!,
        startTime: visit.startsAt.toFormat('HH:mm'),
        durationMinutes: Math.round(visit.endsAt.diff(visit.startsAt, 'minutes').minutes),
        technicianIds: ids,
        notes: visit.notes,
        editable:
          !CLOSED_VISIT_STATUSES.includes(visit.status) && Scheduling.canSchedule(visit.job),
      },
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const visit = await Visit.query().where('id', params.id).preload('technicians').firstOrFail()
    const data = await request.validateUsing(editVisitValidator, {
      meta: { technicianIds: visit.technicians.map((technician) => technician.id) },
    })

    const startsAt = DateTime.fromISO(`${data.date.toISODate()}T${data.startTime}`)
    try {
      await Scheduling.update(visit, {
        startsAt,
        endsAt: startsAt.plus({ minutes: data.durationMinutes }),
        technicianIds: data.technicianIds,
        notes: data.notes ?? null,
      })
    } catch (error) {
      if (error instanceof TechnicianHasHoursError) {
        session.flash('error', i18n.t('flash.technicianHasHours'))
        return response.redirect().toRoute('visits.edit', { id: visit.id })
      }
      if (!(error instanceof VisitNotMovableError)) throw error
      session.flash('error', i18n.t('flash.visitNotEditable'))
      return response.redirect().toRoute('jobs.show', { id: visit.jobId })
    }

    session.flash('success', i18n.t('flash.visitSaved'))
    response.redirect().toRoute('jobs.show', { id: visit.jobId })
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    try {
      await Scheduling.destroy(visit)
    } catch (error) {
      if (error instanceof VisitHasWorkError) {
        session.flash('error', i18n.t('flash.visitHasWork'))
      } else if (error instanceof VisitNotMovableError) {
        session.flash('error', i18n.t('flash.visitNotEditable'))
      } else {
        throw error
      }
      return response.redirect().toRoute('jobs.show', { id: visit.jobId })
    }

    session.flash('success', i18n.t('flash.visitDeleted'))
    response.redirect().toRoute('jobs.show', { id: visit.jobId })
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
      if (error instanceof TechnicianHasHoursError) {
        session.flash('error', i18n.t('flash.technicianHasHours'))
        return response.redirect().back()
      }
      if (!(error instanceof VisitNotMovableError)) throw error
      session.flash('error', i18n.t('flash.visitNotMovable'))
      return response.redirect().back()
    }

    session.flash('success', i18n.t('flash.visitMoved'))
    response.redirect().back()
  }

  /**
   * Visits a Technician marked as needing another visit, with no later
   * Visit planned for the same Job yet.
   */
  async toSchedule({ inertia }: HttpContext) {
    const visits = await Visit.query()
      .where('status', 'needs_return')
      .whereHas('job', (job) => job.whereNot('status', 'cancelled'))
      .whereNotExists((later) =>
        later
          .from('visits as later')
          .whereColumn('later.job_id', 'visits.job_id')
          .whereColumn('later.starts_at', '>', 'visits.starts_at')
      )
      .preload('technicians')
      // One note per Visit: a plain limit would apply across the whole list
      .preload('fieldNotes', (notes) =>
        notes.groupLimit(1).groupOrderBy('visit_notes.created_at', 'desc')
      )
      .preload('job', (job) => job.preload('customer').preload('site'))
      .orderBy('startsAt')

    return inertia.render('visits/to_schedule', {
      visits: visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        technicians: visit.technicians.map((user) => user.fullName ?? user.email),
        lastNote: visit.fieldNotes[0]?.body ?? null,
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
}
