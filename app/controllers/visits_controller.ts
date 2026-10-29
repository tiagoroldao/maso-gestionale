import { DateTime } from 'luxon'
import Job from '#models/job'
import User from '#models/user'
import Visit from '#models/visit'
import Charge from '#models/charge'
import Scheduling, {
  JobNotSchedulableError,
  TechnicianHasHoursError,
  VisitCancelRefusedError,
  VisitHasWorkError,
  VisitNotMovableError,
} from '#services/scheduling'
import FieldWork, { FieldWorkRefusedError } from '#services/field_work'
import Installations from '#services/installations'
import { ChargeRefusedError } from '#services/charges'
import { notDoneIn, visitCloseValidator } from '#validators/field'
import {
  cancellableByOffice,
  closableByOffice,
  isOpenVisit,
  restorableByOffice,
} from '#shared/visits'
import { ACTIVE_JOB_STATUSES } from '#shared/jobs'
import {
  editVisitValidator,
  moveVisitValidator,
  planVisitQueryValidator,
  repeatedVisitsValidator,
  repeatVisitValidator,
  scheduleValidator,
  visitValidator,
} from '#validators/visit'
import { localDateTime } from '#services/dates'
import { addDays, isoWeekday, todayIso } from '#shared/dates'
import { italianHoliday } from '#shared/holidays'
import { MAX_REPEATED_VISITS, repeatedDates } from '#shared/visit_repeats'
import StockLedger from '#stock/stock_ledger'
import { flashWithStockWarning } from '#stock/stock_warning'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Active Technicians, plus the `extra` people already on Visits being
 * shown, whether since deactivated (marked inactive) or no longer
 * Technicians.
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
 * When a Visit on `date` starting at `startTime` begins and ends.
 */
function timeOn(date: string, startTime: string, durationMinutes: number) {
  const startsAt = DateTime.fromISO(`${date}T${startTime}`)
  return { startsAt, endsAt: startsAt.plus({ minutes: durationMinutes }) }
}

/**
 * The fields without empty ones, which a form sends for inputs left blank
 * and the validators would read as given.
 */
function withoutBlanks(query: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''))
}

/**
 * The plan form's props: a new Visit for the Job, starting from `draft`,
 * with the dates of a repeat when one was asked for.
 */
async function planPage<D, P>(job: Job, draft: D, preview: P) {
  return {
    job: { id: job.id, number: job.number, title: job.title, customer: job.customer.displayName },
    technicians: await technicians(),
    visit: null,
    draft,
    preview,
    maxRepeated: MAX_REPEATED_VISITS,
  }
}

/**
 * Planning Visits for Jobs, and the calendar where Office moves them.
 */
export default class VisitsController {
  /**
   * The form to plan a Visit. With `from`, it starts as a copy of that
   * Visit of the Job, on a later day ("plan the next Visit", #177):
   * Technicians, hours and notes, never its Charges.
   */
  async create({ params, request, inertia }: HttpContext) {
    const job = await Job.query().where('id', params.id).preload('customer').firstOrFail()
    const { from } = await planVisitQueryValidator.validate(withoutBlanks(request.qs()))

    let draft = null
    if (from) {
      const source = await Visit.query()
        .where('id', from)
        .where('jobId', job.id)
        .preload('technicians')
        .firstOrFail()
      // The day after the copied Visit, and never in the past
      const next = addDays(source.startsAt.toISODate()!, 1)
      const today = todayIso()
      draft = {
        date: next > today ? next : today,
        startTime: source.startsAt.toFormat('HH:mm'),
        durationMinutes: Math.round(source.endsAt.diff(source.startsAt, 'minutes').minutes),
        technicianIds: source.technicians.map((technician) => technician.id),
        notes: source.notes,
        survey: false,
        repeat: null,
        weekdays: [],
        until: null,
        count: null,
      }
    }
    return inertia.render('visits/create', await planPage(job, draft, null))
  }

  /**
   * The plan form again, listing the dates a repeated Visit would fall on
   * (#177), flagging public holidays and Technicians already booked, for
   * Office to confirm. Posted, not a query string, since the notes run to
   * 5000 characters; it answers on the form's own address, so a reload
   * shows the empty form.
   */
  async repeatDates({ params, request, inertia, response, session, i18n }: HttpContext) {
    const job = await Job.query().where('id', params.id).preload('customer').firstOrFail()
    if (!Scheduling.canSchedule(job)) {
      session.flash('error', i18n.t('flash.jobNotSchedulable'))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    }
    const input = await repeatVisitValidator.validate(withoutBlanks(request.body()))
    const visit = {
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      technicianIds: input.technicianIds,
      notes: input.notes ?? null,
      survey: input.survey ?? false,
    }
    const draft = {
      ...visit,
      date: input.date.toISODate()!,
      repeat: input.repeat,
      weekdays: input.weekdays ?? [],
      until: input.until?.toISODate() ?? null,
      count: input.count ?? null,
    }
    const { dates, truncated } = repeatedDates({
      from: draft.date,
      frequency: input.repeat,
      weekdays: draft.weekdays,
      until: draft.until,
      count: draft.count,
    })
    const clashes = await Scheduling.clashes(
      input.technicianIds,
      dates.map((date) => timeOn(date, input.startTime, input.durationMinutes))
    )
    const preview = {
      ...visit,
      truncated,
      dates: dates.map((date, index) => ({
        date,
        weekday: isoWeekday(date),
        holiday: italianHoliday(date),
        clashes: clashes[index],
      })),
    }
    return inertia.render('visits/create', await planPage(job, draft, preview))
  }

  async store({ params, request, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(visitValidator)

    const { startsAt, endsAt } = timeOn(
      data.date.toISODate()!,
      data.startTime,
      data.durationMinutes
    )
    try {
      await Scheduling.plan(job, {
        startsAt,
        endsAt,
        technicianIds: data.technicianIds,
        notes: data.notes ?? null,
        survey: data.survey ?? false,
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
   * Plans the repeated Visits Office confirmed (#177), all or none: one
   * ordinary Visit per date kept, each independent of the others.
   */
  async storeRepeated({ params, request, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(repeatedVisitsValidator)

    const times = data.dates
      .map((date) => date.toISODate()!)
      .sort()
      .map((date) => timeOn(date, data.startTime, data.durationMinutes))
    try {
      await Scheduling.planMany(job, times, {
        technicianIds: data.technicianIds,
        notes: data.notes ?? null,
        survey: data.survey ?? false,
      })
    } catch (error) {
      if (!(error instanceof JobNotSchedulableError)) throw error
      session.flash('error', i18n.t('flash.jobNotSchedulable'))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    }

    session.flash('success', i18n.t('flash.visitsPlanned', { count: times.length }))
    response
      .redirect()
      .toRoute(
        'visits.schedule',
        {},
        { qs: { date: times[0].startsAt.toFormat('yyyy-MM-dd'), view: 'week' } }
      )
  }

  /**
   * The calendar: one lane per active Technician (plus anyone else on a
   * Visit in view), for a day or a week (Monday to Sunday); Visits with
   * no one on them are listed apart.
   */
  async schedule({ request, inertia }: HttpContext) {
    const { date, view = 'day' } = await scheduleValidator.validate(request.qs())
    const day = (date ?? DateTime.now()).startOf('day')
    const from = view === 'week' ? day.startOf('week') : day
    const to = view === 'week' ? from.plus({ weeks: 1 }) : from.plus({ days: 1 })

    const visits = await Visit.query()
      .where('startsAt', '<', to.toJSDate())
      .where('endsAt', '>', from.toJSDate())
      // A cancelled Job's Visits leave the Agenda (abandoned work); a closed
      // Job's stay, as history that no longer moves (ADR 0015), and so do
      // cancelled Visits, shown as such (#157)
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
          status: visit.status,
          survey: visit.survey,
          job: { number: visit.job.number, customer: visit.job.customer.displayName },
        })),
      visits: visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
        survey: visit.survey,
        technicianIds: visit.technicians.map((technician) => technician.id),
        // Closed or cancelled Visits and a closed Job's Visits can't move
        // (Scheduling)
        movable: isOpenVisit(visit.status) && Scheduling.canSchedule(visit.job),
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
      .preload('startedBy')
      .preload('closedBy')
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
        survey: visit.survey,
        status: visit.status,
        ...visit.milestones(),
        editable: isOpenVisit(visit.status) && Scheduling.canSchedule(visit.job),
        // Left open when the Job was cancelled: Office marks it done (#153)
        closableByOffice: closableByOffice(visit.job.status, visit.status),
        // Office cancels a Visit that won't happen, and restores it (#157)
        cancellable: cancellableByOffice(visit.job.isActive, visit.status),
        restorable: restorableByOffice(visit.job.isActive, visit.status),
        // Copied to a new date as the Job's next Visit (#177)
        plannable: Scheduling.canSchedule(visit.job),
      },
      draft: null,
      preview: null,
      maxRepeated: MAX_REPEATED_VISITS,
    })
  }

  /**
   * Cancels a Visit that won't happen (#157): its Charges become not done,
   * and it stays on the Agenda, read-only.
   */
  async cancel({ params, response, session, auth, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await this.refusable({ session, i18n }, async () => {
      await Scheduling.cancel(visit, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.visitCancelled'))
    })
    response.redirect().toRoute('jobs.show', { id: visit.jobId })
  }

  /**
   * Restores a cancelled Visit, planned again with its Charges (#157).
   */
  async restore({ params, response, session, auth, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await this.refusable({ session, i18n }, async () => {
      await Scheduling.restore(visit, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.visitRestored'))
    })
    response.redirect().toRoute('jobs.show', { id: visit.jobId })
  }

  /**
   * Runs `work`, turning a refusal to cancel or restore (the Job's or the
   * Visit's status, or a Charge in a draft or billed) into a message.
   */
  private async refusable(
    { session, i18n }: Pick<HttpContext, 'session' | 'i18n'>,
    work: () => Promise<void>
  ) {
    try {
      await work()
    } catch (error) {
      if (error instanceof VisitCancelRefusedError) {
        session.flash('error', i18n.t(`flash.visitCancelRefused.${error.reason}`))
      } else if (
        error instanceof ChargeRefusedError &&
        (error.reason === 'inDraft' || error.reason === 'frozen')
      ) {
        session.flash('error', i18n.t(`flash.visitCancelRefused.${error.reason}`))
      } else {
        throw error
      }
    }
  }

  /**
   * Office marks done a Visit left open when its Job was cancelled (#153):
   * its Items come off stock and its Charges become billable, as when the
   * Technician closes it.
   */
  async markDone({ params, request, response, session, auth, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    const review = await request.validateUsing(visitCloseValidator)
    // Its planned Items committed nothing on a cancelled Job, so leaving
    // stock now may leave them short
    const charges = await Charge.query().where('visitId', visit.id).whereNotNull('itemId')
    const itemIds = charges.map((charge) => charge.itemId!)
    const before = await StockLedger.quantities(itemIds)
    try {
      const warnings = await FieldWork.closeOnCancelledJob(
        visit,
        auth.getUserOrFail(),
        notDoneIn(review)
      )
      await flashWithStockWarning(
        { session, i18n },
        itemIds,
        i18n.t('flash.visitMarkedDone'),
        before,
        Installations.messages(i18n, warnings)
      )
    } catch (error) {
      if (!(error instanceof FieldWorkRefusedError)) throw error
      session.flash('error', i18n.t(`flash.fieldWorkRefused.${error.reason}`))
    }
    response.redirect().toRoute('jobs.show', { id: visit.jobId })
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
        survey: data.survey ?? false,
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
      .whereHas('job', (job) => job.whereIn('status', [...ACTIVE_JOB_STATUSES]))
      .whereNotExists((later) =>
        later
          .from('visits as later')
          .whereColumn('later.job_id', 'visits.job_id')
          .whereColumn('later.starts_at', '>', 'visits.starts_at')
          // A cancelled follow-up doesn't count (#157)
          .whereNot('later.status', 'cancelled')
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
