import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { CategorySchema } from '#database/schema'
import Item from '#models/item'

/**
 * A grouping of Items that carries a suggested markup, used only to
 * propose a resale price.
 */
export default class Category extends CategorySchema {
  @hasMany(() => Item)
  declare items: HasMany<typeof Item>
}
