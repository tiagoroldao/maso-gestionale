import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { belongsTo, hasMany, manyToMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { VisitSchema } from '#database/schema'
import Job from '#models/job'
import User from '#models/user'
import VisitNote from '#models/visit_note'
import VisitPhoto from '#models/visit_photo'
import Charge from '#models/charge'
import { TIME_ZONE } from '#shared/dates'
import type { VisitStatus } from '#shared/visits'

/**
 * A single scheduled trip by one or more Technicians to a Site as part of
 * a Job.
 */
export default class Visit extends VisitSchema {
  declare status: VisitStatus

  @belongsTo(() => Job)
  declare job: BelongsTo<typeof Job>

  /**
   * Who marked the Visit in progress (#174).
   */
  @belongsTo(() => User, { foreignKey: 'startedById' })
  declare startedBy: BelongsTo<typeof User>

  /**
   * Who closed the Visit, done or needing another visit (#174).
   */
  @belongsTo(() => User, { foreignKey: 'closedById' })
  declare closedBy: BelongsTo<typeof User>

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
   * The day its work happened (#174), dating the stock it used, the
   * equipment it serviced and the equipment it installed: the day
   * (Europe/Rome) it was marked in progress, or its planned day if it never
   * was, and never later than today.
   */
  workDay(now: DateTime = DateTime.now()) {
    const day = (this.startedAt ?? this.startsAt).setZone(TIME_ZONE).startOf('day')
    const today = now.setZone(TIME_ZONE).startOf('day')
    return day > today ? today : day
  }

  /**
   * When it was marked in progress and when it was closed, and by whom
   * (#174), for the pages: each moment as ISO, the user's name or null if
   * the user was deleted, or null if it never happened (Visits closed
   * before #174 have neither). Needs `startedBy` and `closedBy` preloaded.
   */
  milestones() {
    const name = (user: User | null) => (user ? (user.fullName ?? user.email) : null)
    return {
      started: this.startedAt ? { at: this.startedAt.toISO()!, by: name(this.startedBy) } : null,
      closed: this.closedAt ? { at: this.closedAt.toISO()!, by: name(this.closedBy) } : null,
    }
  }

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
