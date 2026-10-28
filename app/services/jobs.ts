import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Job, { type JobKind } from '#models/job'
import { nextJobSequence } from '#services/job_numbers'
import type { WorkCategory } from '#shared/jobs'

/**
 * The Job has Invoices: cancelling it, or moving it to another Customer,
 * would leave them inconsistent.
 */
export class JobInvoicedError extends Error {}

/**
 * The Job is cancelled and no longer changes.
 */
export class JobNotEditableError extends Error {}

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
   * Saves a Job's details, locked against concurrent cancels and Quote
   * decisions. The kind changes only while the Job is open without a
   * Quote; the Customer only while the Job has no Invoice.
   */
  static update(id: number, input: NewJob) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      if (locked.status === 'cancelled') throw new JobNotEditableError()
      if (input.customerId !== locked.customerId && (await this.hasInvoices(trx, locked.id))) {
        throw new JobInvoicedError()
      }
      locked.merge({
        customerId: input.customerId,
        siteId: input.siteId ?? null,
        workCategory: input.workCategory,
        title: input.title,
        description: input.description ?? null,
      })
      const hasQuote = await trx.from('quotes').where('job_id', locked.id).first()
      if (locked.status === 'open' && !hasQuote) locked.kind = input.kind
      await locked.save()
      return locked
    })
  }

  private static async hasInvoices(trx: TransactionClientContract, jobId: number) {
    return Boolean(await trx.from('invoices').where('job_id', jobId).first())
  }

  /**
   * Cancels the Job (once; cancelling again changes nothing). Locked, so a
   * Quote save or decision can't overwrite the cancellation. Its Visits
   * are kept as history and closed to field work (see FieldWork).
   */
  static cancel(id: number) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      // Invoiced work stays: its Invoices would point at a cancelled Job
      if (await this.hasInvoices(trx, locked.id)) throw new JobInvoicedError()
      if (locked.status !== 'cancelled') {
        locked.status = 'cancelled'
        locked.cancelledAt = DateTime.now()
        await locked.save()
      }
      return locked
    })
  }
}
