import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { ItemDocumentSchema } from '#database/schema'
import Item from '#models/item'

/**
 * A reference file attached to an Item, such as a manual or datasheet.
 * The file lives in the Instance's storage, at `filePath`.
 */
export default class ItemDocument extends ItemDocumentSchema {
  static table = 'item_documents'

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>
}
