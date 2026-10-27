import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Item from '#models/item'
import Job from '#models/job'
import Quote from '#models/quote'
import QuoteLine, { type QuoteLineKind } from '#models/quote_line'
import { lineTotal } from '#shared/money'

export class QuoteNotEditableError extends Error {}

export type QuoteLineInput = {
  kind: QuoteLineKind
  itemId?: number
  labourRateId?: number
  description: string
  quantity?: string
  unitPrice?: string
}

/**
 * The rules around a Job's Quote: when it can be edited, and how
 * accepting or declining it moves the Job.
 */
export default class Quotes {
  /**
   * Whether the Job's Quote can still be written: a Quoted Job that is
   * open or quoted, whose Quote hasn't been decided.
   */
  static isEditable(job: Job, quote: Quote | null) {
    return (
      job.kind === 'quoted' &&
      (job.status === 'open' || job.status === 'quoted') &&
      (!quote || quote.status === 'draft')
    )
  }

  /**
   * Replaces the Quote's lines (creating the Quote if needed) and marks the
   * Job as quoted once the Quote has a priced line.
   */
  static async save(job: Job, input: { notes?: string | null; lines: QuoteLineInput[] }) {
    return db.transaction(async (trx) => {
      // Lock the Job first, so a cancel or another save can't interleave
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      job.merge({ status: locked.status, kind: locked.kind })
      job.useTransaction(trx)
      const quote = await Quote.query({ client: trx }).where('jobId', job.id).forUpdate().first()
      if (!this.isEditable(job, quote)) throw new QuoteNotEditableError()

      const saved =
        quote ?? (await Quote.create({ jobId: job.id, status: 'draft' }, { client: trx }))
      saved.useTransaction(trx)
      saved.notes = input.notes ?? null
      await saved.save()

      const units = await this.itemUnits(input.lines, trx)
      await QuoteLine.query({ client: trx }).where('quoteId', saved.id).delete()
      await QuoteLine.createMany(
        input.lines.map((line, index) => this.toRow(saved.id, index, line, units)),
        { client: trx }
      )

      const priced = input.lines.some((line) => line.kind !== 'text')
      job.status = priced ? 'quoted' : 'open'
      await job.save()
      return saved
    })
  }

  static async accept(job: Job) {
    await this.decide(job, 'accepted', 'accepted')
  }

  static async decline(job: Job) {
    await this.decide(job, 'declined', 'cancelled')
  }

  private static async decide(
    job: Job,
    quoteStatus: 'accepted' | 'declined',
    jobStatus: 'accepted' | 'cancelled'
  ) {
    await db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      job.merge({ status: locked.status, kind: locked.kind })
      job.useTransaction(trx)
      const quote = await Quote.query({ client: trx })
        .where('jobId', job.id)
        .preload('lines')
        .forUpdate()
        .first()
      if (!quote || job.status !== 'quoted' || quote.status !== 'draft') {
        throw new QuoteNotEditableError()
      }

      quote.useTransaction(trx)
      quote.status = quoteStatus
      quote.decidedAt = DateTime.now()
      await quote.save()

      job.status = jobStatus
      if (jobStatus === 'cancelled') job.cancelledAt = DateTime.now()
      await job.save()
    })
  }

  private static async itemUnits(lines: QuoteLineInput[], trx: TransactionClientContract) {
    const ids = lines.flatMap((line) => (line.kind === 'item' && line.itemId ? [line.itemId] : []))
    if (!ids.length) return new Map<number, string>()
    const items = await Item.query({ client: trx }).whereIn('id', ids)
    return new Map(items.map((item) => [item.id, item.unit]))
  }

  private static toRow(
    quoteId: number,
    position: number,
    line: QuoteLineInput,
    units: Map<number, string>
  ) {
    if (line.kind === 'text') {
      return { quoteId, position, kind: line.kind, description: line.description }
    }
    const quantity = line.quantity!
    const unitPrice = line.unitPrice!
    return {
      quoteId,
      position,
      kind: line.kind,
      itemId: line.kind === 'item' ? line.itemId! : null,
      labourRateId: line.kind === 'labour' ? line.labourRateId! : null,
      description: line.description,
      quantity,
      unit:
        line.kind === 'item'
          ? (units.get(line.itemId!) ?? null)
          : line.kind === 'labour'
            ? 'h'
            : null,
      unitPrice,
      lineTotal: lineTotal(quantity, unitPrice),
    }
  }
}
