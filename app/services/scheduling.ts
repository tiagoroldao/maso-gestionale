import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import Visit from '#models/visit'
import { CLOSED_VISIT_STATUSES } from '#services/field_work'

export class JobNotSchedulableError extends Error {}

/**
 * The Visit changed since the page was loaded (another user moved it), or
 * can no longer move (closed, or its Job was cancelled).
 */
export class VisitNotMovableError extends Error {}

/**
 * Scheduling Visits and the Job status changes it causes.
 */
export default class Scheduling {
  /**
   * A cancelled Job gets no more Visits.
   */
  static canSchedule(job: Job) {
    return job.status !== 'cancelled'
  }

  /**
   * Plans a Visit. When the Job is ready for work (an accepted Quoted Job,
   * or an open Time & Materials Job) it moves to In Progress; a survey
   * before the Quote is accepted leaves the Job's status alone.
   */
  static async plan(
    job: Job,
    input: { startsAt: DateTime; endsAt: DateTime; technicianIds: number[]; notes?: string | null }
  ) {
    return db.transaction(async (trx) => {
      // Locked and re-read, so a concurrent cancel can't be overwritten
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      job.merge({ status: locked.status, kind: locked.kind })
      if (!this.canSchedule(job)) throw new JobNotSchedulableError()

      const visit = await Visit.create(
        {
          jobId: job.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status: 'planned',
          notes: input.notes ?? null,
        },
        { client: trx }
      )
      await visit.related('technicians').attach(input.technicianIds)

      const readyForWork =
        (job.kind === 'quoted' && job.status === 'accepted') ||
        (job.kind === 'time_and_materials' && job.status === 'open')
      if (readyForWork) {
        await Job.query({ client: trx }).where('id', job.id).update({ status: 'in_progress' })
        job.status = 'in_progress'
      }
      return visit
    })
  }

  /**
   * Moves a Visit to a new start (keeping its length) and, when dropped on
   * another Technician's lane, hands it from one Technician to the other.
   */
  static async move(
    visit: Visit,
    input: { startsAt: DateTime; fromTechnicianId?: number; toTechnicianId?: number }
  ) {
    await db.transaction(async (trx) => {
      const locked = await Visit.query({ client: trx })
        .where('id', visit.id)
        .forUpdate()
        .preload('job')
        .preload('technicians')
        .firstOrFail()
      if (CLOSED_VISIT_STATUSES.includes(locked.status) || locked.job.status === 'cancelled') {
        throw new VisitNotMovableError()
      }

      const { fromTechnicianId: from, toTechnicianId: to } = input
      const current = locked.technicians.map((technician) => technician.id)
      const handOver = from && to && from !== to
      // A stale page (someone already moved it) must not add a Technician
      if (handOver && !current.includes(from)) throw new VisitNotMovableError()

      const length = locked.endsAt.diff(locked.startsAt)
      locked.useTransaction(trx)
      locked.startsAt = input.startsAt
      locked.endsAt = input.startsAt.plus(length)
      await locked.save()

      if (handOver) {
        // Dropping on a lane hands the Visit over; if the target Technician
        // was already on it, the Visit simply loses the original one
        await locked.related('technicians').detach([from])
        await locked.related('technicians').sync([to], false)
      }
    })
  }
}
