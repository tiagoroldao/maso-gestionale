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
 * A Technician who logged hours on the Visit can't be taken off it: the
 * hours would belong to someone no longer on the Visit.
 */
export class TechnicianHasHoursError extends Error {}

/**
 * Scheduling Visits and the Job status changes it causes: a Job's status
 * follows its work (ADR 0013).
 */
export default class Scheduling {
  /**
   * A cancelled Job gets no more Visits.
   */
  static canSchedule(job: Job) {
    return job.status !== 'cancelled'
  }

  /**
   * Whether the Job has any work Visit, past or to come: Surveys don't
   * count (ADR 0013).
   */
  private static async hasWorkVisits(trx: TransactionClientContract, jobId: number) {
    return Boolean(await trx.from('visits').where('job_id', jobId).where('survey', false).first())
  }

  /**
   * Sets the Job's status from its work (ADR 0013): open until a work
   * Visit is planned (Surveys don't count), then in progress, back to open
   * if none is left. Its Quotes play no part; a cancelled Job stays so.
   * Called after any change to the Job's Visits that could matter
   * (planning, editing, deleting); the caller holds the Job's update lock.
   */
  private static async followWork(trx: TransactionClientContract, job: Job) {
    if (job.status === 'cancelled') return
    const status = (await this.hasWorkVisits(trx, job.id)) ? 'in_progress' : 'open'
    if (job.status === status) return
    await Job.query({ client: trx }).where('id', job.id).update({ status })
    job.status = status
  }

  /**
   * Changes a Visit that isn't closed: when, how long, who, the notes for
   * the team and whether it is a Survey. Anyone already on it may stay,
   * even if since deactivated or no longer a Technician (the validator
   * checks the rest); anyone who logged hours on it must stay. The Job's
   * status then follows its work again, as after planning or deleting a
   * Visit (turning the only work Visit into a Survey reopens the Job).
   */
  static async update(
    visit: Visit,
    input: {
      startsAt: DateTime
      endsAt: DateTime
      technicianIds: number[]
      notes: string | null
      survey: boolean
    }
  ) {
    await db.transaction(async (trx) => {
      // The Job may change status below: lock it for update from the start
      const locked = await this.lockOpenVisit(trx, visit.id, 'update')
      locked.useTransaction(trx)
      locked.merge({
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        notes: input.notes,
        survey: input.survey,
      })
      await locked.save()
      const removed = locked.technicians
        .map((technician) => technician.id)
        .filter((id) => !input.technicianIds.includes(id))
      await this.refuseIfLoggedHours(trx, locked.id, removed)
      await locked.related('technicians').sync(input.technicianIds)

      const job = await Job.query({ client: trx }).where('id', locked.jobId).firstOrFail()
      await this.followWork(trx, job)
    })
  }

  /**
   * Hours are logged while the Visit is locked (FieldWork), so with the
   * Visit locked here this check can't miss any.
   */
  private static async refuseIfLoggedHours(
    trx: TransactionClientContract,
    visitId: number,
    technicianIds: number[]
  ) {
    if (!technicianIds.length) return
    const logged = await trx
      .from('charges')
      .where('visit_id', visitId)
      .whereIn('user_id', technicianIds)
      .first()
    if (logged) throw new TechnicianHasHoursError()
  }

  /**
   * Deletes a Visit planned by mistake. One with recorded work is refused.
   * If the Job has no other work Visit (done or to come), it is open again.
   */
  static async destroy(visit: Visit) {
    await db.transaction(async (trx) => {
      // The Job may change status below: lock it for update from the start
      const locked = await this.lockOpenVisit(trx, visit.id, 'update')
      for (const table of ['charges', 'visit_photos', 'visit_notes']) {
        if (await trx.from(table).where('visit_id', locked.id).first()) {
          throw new VisitHasWorkError()
        }
      }
      await locked.useTransaction(trx).delete()

      const job = await Job.query({ client: trx }).where('id', locked.jobId).firstOrFail()
      await this.followWork(trx, job)
    })
  }

  /**
   * Locks the Visit, then its Job (the order field work uses): shared by
   * default, for update when the caller may change the Job's status
   * (update, destroy). Refuses a closed Visit or one whose Job was
   * cancelled.
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
   * Plans a Visit. A work Visit moves an open Job to In Progress
   * (followWork); a Survey never moves the Job (ADR 0013).
   */
  static async plan(
    job: Job,
    input: {
      startsAt: DateTime
      endsAt: DateTime
      technicianIds: number[]
      notes?: string | null
      survey?: boolean
    }
  ) {
    return db.transaction(async (trx) => {
      // Locked and re-read, so a concurrent cancel can't be overwritten
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      job.merge({ status: locked.status })
      if (!this.canSchedule(job)) throw new JobNotSchedulableError()

      const visit = await Visit.create(
        {
          jobId: job.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status: 'planned',
          notes: input.notes ?? null,
          survey: input.survey ?? false,
        },
        { client: trx }
      )
      await visit.related('technicians').attach(input.technicianIds)

      await this.followWork(trx, job)
      return visit
    })
  }

  /**
   * Moves a Visit to a new start (keeping its length) and, when dropped on
   * another Technician's lane, hands it from one Technician to the other.
   * The Job's status doesn't change: it depends on which work Visits exist,
   * not on when they are.
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
      if (handOver) await this.refuseIfLoggedHours(trx, locked.id, [from])

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
