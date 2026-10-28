import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Quote from '#models/quote'
import type Job from '#models/job'

/**
 * A Quote on the Job, numbered after its last one, as `Quotes.create`
 * does. One past draft was sent now, unless given otherwise.
 */
export async function createQuote(job: Job, attributes: Partial<Quote> = {}) {
  const last = await db.from('quotes').where('job_id', job.id).max('sequence as max').first()
  const status = attributes.status ?? 'draft'
  return Quote.create({
    jobId: job.id,
    sequence: Number(last?.max ?? 0) + 1,
    status,
    sentAt: status === 'draft' ? null : DateTime.now(),
    ...attributes,
  })
}
