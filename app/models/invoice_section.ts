import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { InvoiceSectionSchema } from '#database/schema'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'

/**
 * A heading that orders and frames an Invoice's lines on its PDF, with
 * its subtotal if shown (#184, ADR 0018). The FatturaPA XML has no
 * sections: its lines stay flat, in the same order.
 */
export default class InvoiceSection extends InvoiceSectionSchema {
  static table = 'invoice_sections'

  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>

  @hasMany(() => InvoiceLine, { foreignKey: 'sectionId' })
  declare lines: HasMany<typeof InvoiceLine>
}
