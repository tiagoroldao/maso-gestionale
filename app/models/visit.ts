import { belongsTo, manyToMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, ManyToMany } from '@adonisjs/lucid/types/relations'
import { VisitSchema } from '#database/schema'
import Job from '#models/job'
import User from '#models/user'

export const VISIT_STATUSES = ['planned', 'in_progress', 'done', 'needs_return'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]

/**
 * A single scheduled trip by one or more Technicians to a Site as part of
 * a Job.
 */
export default class Visit extends VisitSchema {
  declare status: VisitStatus

  @belongsTo(() => Job)
  declare job: BelongsTo<typeof Job>

  @manyToMany(() => User, { pivotTable: 'visit_technicians', pivotRelatedForeignKey: 'user_id' })
  declare technicians: ManyToMany<typeof User>
}
