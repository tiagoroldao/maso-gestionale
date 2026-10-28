import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Job from '#models/job'
import { nextJobSequence } from '#services/job_numbers'
import Archiving from '#services/archiving'
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
  workCategory: WorkCategory
  title: string
  description?: string | null
}

/**
 * Opening, editing and cancelling Jobs. Declining a Quote never cancels its
 * Job (ADR 0013): Office cancels it here when nothing else goes ahead.
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
   * decisions. The Customer changes only while the Job has no Invoice.
   */
  static update(id: number, input: NewJob) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      if (locked.status === 'cancelled') throw new JobNotEditableError()
      if (input.customerId !== locked.customerId && (await this.hasInvoices(trx, locked.id))) {
        throw new JobInvoicedError()
      }
      // A newly picked Customer or Site must not be archived (locked, as on create)
      if (input.customerId !== locked.customerId || (input.siteId ?? null) !== locked.siteId) {
        await Archiving.lockActive(trx, {
          customerId: input.customerId,
          siteId: (input.siteId ?? null) !== locked.siteId ? input.siteId : null,
        })
      }
      locked.merge({
        customerId: input.customerId,
        siteId: input.siteId ?? null,
        workCategory: input.workCategory,
        title: input.title,
        description: input.description ?? null,
      })
      await locked.save()
      return locked
    })
  }

  private static async hasInvoices(trx: TransactionClientContract, jobId: number) {
    return Boolean(await trx.from('invoices').where('job_id', jobId).first())
  }

  /**
   * Cancels the Job (once; cancelling again changes nothing). Locked, so a
   * Quote save or decision can't slip past the cancellation. Its Visits
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
