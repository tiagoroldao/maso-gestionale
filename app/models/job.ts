import { belongsTo, hasMany, hasOne, scope } from '@adonisjs/lucid/orm'
import db from '@adonisjs/lucid/services/db'
import type { BelongsTo, HasMany, HasOne } from '@adonisjs/lucid/types/relations'
import { JobSchema } from '#database/schema'
import Customer from '#models/customer'
import Site from '#models/site'
import Quote from '#models/quote'
import Visit from '#models/visit'
import Invoice from '#models/invoice'
import type { WorkCategory } from '#shared/jobs'
import { BILLING_OPEN_SQL } from '#services/job_status'

/**
 * Statuses stored on the Job. Quoted and accepted apply only to a Job with
 * a Quote; without one a Job goes from open to in progress (ADR 0012).
 * Work Complete, Invoiced and Closed are worked out from Visits, Invoices
 * and Payments (job_status.ts).
 */
export const JOB_STATUSES = ['open', 'quoted', 'accepted', 'in_progress', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/**
 * A whole piece of work for a Customer, which may span multiple Visits and
 * is the unit that gets quoted and invoiced.
 */
export default class Job extends JobSchema {
  declare status: JobStatus
  declare workCategory: WorkCategory

  /**
   * Adds whether work is still left to bill (`$extras.billing_open`),
   * which the displayed status needs (job_status.ts).
   */
  static withBillingState = scope((query) => {
    query.select('jobs.*').select(db.raw(`(${BILLING_OPEN_SQL}) AS billing_open`))
  })

  @hasMany(() => Invoice)
  declare invoices: HasMany<typeof Invoice>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => Site)
  declare site: BelongsTo<typeof Site>

  @hasOne(() => Quote)
  declare quote: HasOne<typeof Quote>

  @hasMany(() => Visit)
  declare visits: HasMany<typeof Visit>

  /**
   * The Job number people quote: "2026/0007".
   */
  get number() {
    return `${this.year}/${String(this.sequence).padStart(4, '0')}`
  }

  get isActive() {
    return this.status !== 'cancelled'
  }
}
