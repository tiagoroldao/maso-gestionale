import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { PaymentSchema } from '#database/schema'
import Invoice from '#models/invoice'

/**
 * An amount received against an Invoice; an Invoice may have several.
 */
export default class Payment extends PaymentSchema {
  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>
}
