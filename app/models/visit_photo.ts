import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { VisitPhotoSchema } from '#database/schema'
import User from '#models/user'

/**
 * A photo taken on a Visit. The file lives in the Instance's storage.
 */
export default class VisitPhoto extends VisitPhotoSchema {
  static table = 'visit_photos'

  @belongsTo(() => User)
  declare author: BelongsTo<typeof User>
}
