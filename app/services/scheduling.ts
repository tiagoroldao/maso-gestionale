import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
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
 * The Visit has recorded work (hours, Items, photos or notes): it is part
 * of the Job's history and can't be deleted.
 */
export class VisitHasWorkError extends Error {}

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
   * Whether the Job has upcoming or ongoing work: a Visit in progress, or a
   * planned one not yet over. A past survey doesn't count.
   */
  static async hasPendingWork(trx: TransactionClientContract, jobId: number) {
    const pending = await trx
      .from('visits')
      .where('job_id', jobId)
      .where((visits) =>
        visits
          .where('status', 'in_progress')
          .orWhere((planned) =>
            planned.where('status', 'planned').where('ends_at', '>', new Date())
          )
      )
      .first()
    return Boolean(pending)
  }

  /**
   * Changes a Visit that isn't closed: when, how long, who and the notes
   * for the team. Technicians already on it stay allowed even if since
   * deactivated (the validator checks the rest).
   */
  static async update(
    visit: Visit,
    input: { startsAt: DateTime; endsAt: DateTime; technicianIds: number[]; notes: string | null }
  ) {
    await db.transaction(async (trx) => {
      const locked = await this.lockOpenVisit(trx, visit.id)
      locked.useTransaction(trx)
      locked.merge({ startsAt: input.startsAt, endsAt: input.endsAt, notes: input.notes })
      await locked.save()
      await locked.related('technicians').sync(input.technicianIds)
    })
  }

  /**
   * Deletes a Visit planned by mistake. One with recorded work is refused.
   * If no upcoming or ongoing work is left, an In Progress Job goes back
   * to ready for work (accepted, or open).
   */
  static async destroy(visit: Visit) {
    await db.transaction(async (trx) => {
      // The Job may change status below: lock it for update from the start
      const locked = await this.lockOpenVisit(trx, visit.id, 'update')
      for (const table of ['visit_hours', 'visit_items', 'visit_photos', 'visit_notes']) {
        if (await trx.from(table).where('visit_id', locked.id).first()) {
          throw new VisitHasWorkError()
        }
      }
      await locked.useTransaction(trx).delete()

      const job = await Job.query({ client: trx }).where('id', locked.jobId).firstOrFail()
      job.useTransaction(trx)
      // Without other upcoming or ongoing work (a finished survey doesn't
      // count), the Job is back to waiting for its first work Visit
      if (job.status === 'in_progress' && !(await this.hasPendingWork(trx, job.id))) {
        job.status = job.kind === 'quoted' ? 'accepted' : 'open'
        await job.save()
      }
    })
  }

  /**
   * Locks the Visit, then share-locks its Job (the order field work uses),
   * refusing a closed Visit or one whose Job was cancelled.
   */
  private static async lockOpenVisit(
    trx: TransactionClientContract,
    visitId: number,
    jobLock: 'share' | 'update' = 'share'
  ) {
    const locked = await Visit.query({ client: trx })
      .where('id', visitId)
      .forUpdate()
      .preload('technicians')
      .firstOrFail()
    const query = Job.query({ client: trx }).where('id', locked.jobId)
    const job = await (jobLock === 'update' ? query.forUpdate() : query.forShare()).firstOrFail()
    if (CLOSED_VISIT_STATUSES.includes(locked.status) || job.status === 'cancelled') {
      throw new VisitNotMovableError()
    }
    return locked
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
      const locked = await this.lockOpenVisit(trx, visit.id)

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
