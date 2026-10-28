import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { QuoteLineSchema } from '#database/schema'
import Item from '#models/item'
import LabourRate from '#models/labour_rate'
import VatCode from '#models/vat_code'

export const QUOTE_LINE_KINDS = ['item', 'labour', 'call_out', 'text'] as const
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number]

export default class QuoteLine extends QuoteLineSchema {
  static table = 'quote_lines'

  declare kind: QuoteLineKind

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  @belongsTo(() => LabourRate)
  declare labourRate: BelongsTo<typeof LabourRate>

  @belongsTo(() => VatCode)
  declare vatCode: BelongsTo<typeof VatCode>
}
