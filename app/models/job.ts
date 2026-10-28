import { belongsTo, hasMany, scope } from '@adonisjs/lucid/orm'
import db from '@adonisjs/lucid/services/db'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { JobSchema } from '#database/schema'
import Customer from '#models/customer'
import Site from '#models/site'
import Quote from '#models/quote'
import Visit from '#models/visit'
import Invoice from '#models/invoice'
import { takesNewWork, type JobStatus, type WorkCategory } from '#shared/jobs'
import { BILLING_OPEN_SQL } from '#services/job_status'

export { JOB_STATUSES, type JobStatus } from '#shared/jobs'

/**
 * A whole piece of work for a Customer, which may span multiple Visits and
 * is the unit that gets quoted (in one or more Quotes) and invoiced.
 */
export default class Job extends JobSchema {
  declare status: JobStatus
  declare workCategory: WorkCategory

  /**
   * Adds whether work is still left to bill (`$extras.billing_open`),
   * which the invoiced indicator needs (job_status.ts).
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

  @hasMany(() => Quote)
  declare quotes: HasMany<typeof Quote>

  @hasMany(() => Visit)
  declare visits: HasMany<typeof Visit>

  /**
   * The Job number people quote: "2026/0007".
   */
  get number() {
    return `${this.year}/${String(this.sequence).padStart(4, '0')}`
  }

  /**
   * Takes new work: neither closed nor cancelled (ADR 0015).
   */
  get isActive() {
    return takesNewWork(this.status)
  }
}
