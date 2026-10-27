import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { VisitHourSchema } from '#database/schema'
import LabourRate from '#models/labour_rate'
import User from '#models/user'

/**
 * Hours a Technician worked on a Visit, at a Labour Rate.
 */
export default class VisitHour extends VisitHourSchema {
  static table = 'visit_hours'

  @belongsTo(() => User)
  declare technician: BelongsTo<typeof User>

  @belongsTo(() => LabourRate)
  declare labourRate: BelongsTo<typeof LabourRate>
}
