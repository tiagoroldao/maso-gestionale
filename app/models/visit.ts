import db from '@adonisjs/lucid/services/db'
import { belongsTo, hasMany, manyToMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { VisitSchema } from '#database/schema'
import Job from '#models/job'
import User from '#models/user'
import VisitNote from '#models/visit_note'
import VisitPhoto from '#models/visit_photo'
import Charge from '#models/charge'

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

  @hasMany(() => VisitNote)
  declare fieldNotes: HasMany<typeof VisitNote>

  @hasMany(() => VisitPhoto)
  declare photos: HasMany<typeof VisitPhoto>

  @hasMany(() => Charge)
  declare charges: HasMany<typeof Charge>

  /**
   * The Visit's hours: its labour Charges.
   */
  @hasMany(() => Charge, { onQuery: (query) => query.where('kind', 'labour') })
  declare hours: HasMany<typeof Charge>

  /**
   * The Items used on the Visit: its Item Charges.
   */
  @hasMany(() => Charge, { onQuery: (query) => query.where('kind', 'item') })
  declare items: HasMany<typeof Charge>

  /**
   * Whether `user` is one of the Technicians assigned to this Visit.
   */
  async isAssignedTo(user: User) {
    const row = await db
      .from('visit_technicians')
      .where('visit_id', this.id)
      .where('user_id', user.id)
      .first()
    return Boolean(row)
  }
}
