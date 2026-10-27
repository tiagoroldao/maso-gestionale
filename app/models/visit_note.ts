import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { VisitNoteSchema } from '#database/schema'
import User from '#models/user'

/**
 * A note written on a Visit, usually by a Technician in the field.
 */
export default class VisitNote extends VisitNoteSchema {
  static table = 'visit_notes'

  @belongsTo(() => User)
  declare author: BelongsTo<typeof User>
}
