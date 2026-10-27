import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { InvoiceLineSchema } from '#database/schema'
import Item from '#models/item'
import VatCode from '#models/vat_code'

/**
 * One line of an Invoice: an Item or free text, priced, with the VAT
 * treatment copied from its VAT Code.
 */
export default class InvoiceLine extends InvoiceLineSchema {
  static table = 'invoice_lines'

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  @belongsTo(() => VatCode)
  declare vatCode: BelongsTo<typeof VatCode>
}
