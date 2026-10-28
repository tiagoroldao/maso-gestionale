import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Job from '#models/job'
import { nextJobSequence } from '#services/job_numbers'
import Archiving from '#services/archiving'
import type { WorkCategory } from '#shared/jobs'
import {
  ADVANCE_DEDUCTED_SQL,
  OUTSTANDING_SQL,
  OWED_SQL,
  VISIT_TO_DO_SQL,
} from '#services/job_status'

/**
 * The Job has Invoices: cancelling it, or moving it to another Customer,
 * would leave them inconsistent.
 */
export class JobInvoicedError extends Error {}

/**
 * The Job is cancelled and no longer changes.
 */
export class JobNotEditableError extends Error {}

/**
 * The Job is closed: it is reopened before it is cancelled.
 */
export class JobClosedError extends Error {}

export type NewJob = {
  customerId: number
  siteId?: number | null
  workCategory: WorkCategory
  title: string
  description?: string | null
}

/**
 * Opening, editing, closing, reopening and cancelling Jobs. Declining a
 * Quote never cancels its Job (ADR 0013): Office cancels it here when
 * nothing else goes ahead, and closes it here when its work is finished
 * (ADR 0015).
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
   * are kept as history and closed to field work (see FieldWork); its
   * recorded Charges can still be billed (#111). A closed Job is reopened
   * first.
   */
  static cancel(id: number) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      if (locked.status === 'cancelled') return locked
      if (locked.status === 'closed') throw new JobClosedError()
      // A Job already invoiced is closed instead (ADR 0015); a cancelled one
      // may still invoice its recorded work afterwards (#111)
      if (await this.hasInvoices(trx, locked.id)) throw new JobInvoicedError()
      locked.status = 'cancelled'
      locked.cancelledAt = DateTime.now()
      await locked.save()
      return locked
    })
  }

  /**
   * Closes the Job by hand (ADR 0015): never refused for what is left,
   * which is returned for Office to see (leftToClose). Closing a closed
   * Job changes nothing; a cancelled one is refused. Locks the Job, then
   * its Customer and Site, as reopening and archiving do.
   */
  static close(id: number) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      if (locked.status === 'cancelled') throw new JobNotEditableError()
      await Archiving.lockShared(trx, locked)
      const left = await this.leftToClose(locked.id, trx)
      if (locked.status !== 'closed') {
        locked.status = 'closed'
        locked.closedAt = DateTime.now()
        await locked.save()
      }
      return { job: locked, left }
    })
  }

  /**
   * Reopens a closed Job when more work turns up: open or in progress by
   * its Visits, as Scheduling sets it (ADR 0013). Reopening an active Job
   * changes nothing; a cancelled one is refused, and so is one whose
   * Customer or Site is archived (restore it first). The Customer and Site
   * are share-locked after the Job, so an archiving at the same moment
   * either sees the Job reopened or refuses it here.
   */
  static reopen(id: number) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      if (locked.status === 'cancelled') throw new JobNotEditableError()
      if (locked.status !== 'closed') return locked
      await Archiving.lockActive(trx, locked)
      const working = await trx
        .from('visits')
        .where('job_id', locked.id)
        .where('survey', false)
        .first()
      locked.status = working ? 'in_progress' : 'open'
      locked.closedAt = null
      await locked.save()
      return locked
    })
  }

  /**
   * What is left on a Job, which closing shows but never refuses for (ADR
   * 0015): Visits still to do (planned or under way, or needing another
   * visit with none planned), Charges still to bill (in a draft or not),
   * issued Invoices unpaid or overpaid, issued Advance Invoices not yet
   * fully taken back, and draft Invoices (a draft advance can't be
   * finalised once the Job is closed).
   */
  static async leftToClose(jobId: number, client?: TransactionClientContract) {
    const row = await (client ?? db)
      .from('jobs')
      .where('jobs.id', jobId)
      .select(
        db.raw(`(SELECT count(*) FROM visits v
          WHERE v.job_id = jobs.id AND ${VISIT_TO_DO_SQL('v')})::int AS visits`),
        db.raw(`(SELECT count(*) FROM charges c
          WHERE c.job_id = jobs.id AND ${OUTSTANDING_SQL('c')})::int AS charges`),
        db.raw(`(SELECT count(*) FROM invoices i
          WHERE i.job_id = jobs.id AND i.status <> 'draft' AND ${OWED_SQL('i')} > 0)::int AS unpaid`),
        db.raw(`(SELECT count(*) FROM invoices i
          WHERE i.job_id = jobs.id AND i.status <> 'draft' AND ${OWED_SQL('i')} < 0)::int AS overpaid`),
        db.raw(`(SELECT count(*) FROM invoices a
          WHERE a.job_id = jobs.id AND a.advance AND a.status <> 'draft'
            AND a.total > ${ADVANCE_DEDUCTED_SQL('a')})::int AS advances`),
        db.raw(`(SELECT count(*) FROM invoices d
          WHERE d.job_id = jobs.id AND d.status = 'draft')::int AS drafts`)
      )
      .firstOrFail()
    return row as JobLeftovers
  }
}

/**
 * How many of each thing is left on a Job when it closes (leftToClose).
 */
export type JobLeftovers = {
  visits: number
  charges: number
  unpaid: number
  overpaid: number
  advances: number
  drafts: number
}
