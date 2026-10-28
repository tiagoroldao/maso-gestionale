import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Job, { type JobKind } from '#models/job'
import { nextJobSequence } from '#services/job_numbers'
import Archiving from '#services/archiving'
import type { WorkCategory } from '#shared/jobs'

export type NewJob = {
  customerId: number
  siteId?: number | null
  kind: JobKind
  workCategory: WorkCategory
  title: string
  description?: string | null
}

/**
 * Opening and cancelling Jobs. A Quote's decline cancels through
 * `Quotes`, which holds its own lock on the Job.
 */
export default class Jobs {
  /**
   * Opens a Job with the year's next number, taken under a lock so
   * concurrent openings never share one.
   */
  static create(input: NewJob) {
    return db.transaction(async (trx) => {
      await Archiving.lockActive(trx, input)
      const year = DateTime.now().year
      return Job.create(
        {
          year,
          sequence: await nextJobSequence(trx, year),
          customerId: input.customerId,
          siteId: input.siteId ?? null,
          kind: input.kind,
          workCategory: input.workCategory,
          status: 'open',
          title: input.title,
          description: input.description ?? null,
        },
        { client: trx }
      )
    })
  }

  /**
   * Cancels the Job (once; cancelling again changes nothing). Locked, so a
   * Quote save or decision can't overwrite the cancellation. Its Visits
   * are kept as history and closed to field work (see FieldWork).
   */
  static cancel(id: number) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      if (locked.status !== 'cancelled') {
        locked.status = 'cancelled'
        locked.cancelledAt = DateTime.now()
        await locked.save()
      }
      return locked
    })
  }
}
