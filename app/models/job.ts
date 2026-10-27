import { belongsTo, hasMany, hasOne } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, HasOne } from '@adonisjs/lucid/types/relations'
import { JobSchema } from '#database/schema'
import Customer from '#models/customer'
import Site from '#models/site'
import Quote from '#models/quote'
import Visit from '#models/visit'

export const JOB_KINDS = ['quoted', 'time_and_materials'] as const
export type JobKind = (typeof JOB_KINDS)[number]

/**
 * The kind of work, which with the Customer type and the Site decides the
 * default VAT on the Job's Invoice lines.
 */
export const WORK_CATEGORIES = [
  'new_installation',
  'maintenance',
  'renovation',
  'repair',
  'sale',
] as const
export type WorkCategory = (typeof WORK_CATEGORIES)[number]

/**
 * Statuses stored on the Job. Work Complete, Invoiced and Closed are
 * worked out from Visits, Invoices and Payments by later features.
 */
export const JOB_STATUSES = ['open', 'quoted', 'accepted', 'in_progress', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/**
 * A whole piece of work for a Customer, which may span multiple Visits and
 * is the unit that gets quoted and invoiced.
 */
export default class Job extends JobSchema {
  declare kind: JobKind
  declare status: JobStatus
  declare workCategory: WorkCategory

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
