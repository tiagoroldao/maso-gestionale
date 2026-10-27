import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import Visit from '#models/visit'

export class JobNotSchedulableError extends Error {}

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
    if (!this.canSchedule(job)) throw new JobNotSchedulableError()

    return db.transaction(async (trx) => {
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
    const length = visit.endsAt.diff(visit.startsAt)

    await db.transaction(async (trx) => {
      visit.useTransaction(trx)
      visit.startsAt = input.startsAt
      visit.endsAt = input.startsAt.plus(length)
      await visit.save()

      const { fromTechnicianId: from, toTechnicianId: to } = input
      if (from && to && from !== to) {
        await visit.related('technicians').detach([from])
        await visit.related('technicians').sync([to], false)
      }
    })
  }
}
