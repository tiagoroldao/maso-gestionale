import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { VatRuleSchema } from '#database/schema'
import VatCode from '#models/vat_code'
import type { CustomerType } from '#models/customer'
import type { WorkCategory } from '#shared/jobs'
import type { LineKind } from '#shared/vat'

/**
 * The VAT Code a new line of a Job's Invoice or Quote gets, by Customer
 * type, Work Category, whether the Site is mainly residential, and the
 * line's kind. One row per combination, edited by the Admin (ADR 0008).
 */
export default class VatRule extends VatRuleSchema {
  static table = 'vat_rules'

  declare customerType: CustomerType
  declare workCategory: WorkCategory
  declare lineKind: LineKind

  @belongsTo(() => VatCode)
  declare vatCode: BelongsTo<typeof VatCode>
}
