import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { LegacyVatRowSchema } from '#database/schema'
import Invoice from '#models/invoice'
import VatCode from '#models/vat_code'

/**
 * One VAT row of a Legacy advance (#27), as its PDF summarises it: the VAT
 * Code's treatment copied (ADR 0008), the taxable amount, and its VAT
 * worked out at the rate (legacyRowVat()). Later Invoices take the
 * advance back row by row (ADR 0011).
 */
export default class LegacyVatRow extends LegacyVatRowSchema {
  static table = 'legacy_vat_rows'

  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>

  @belongsTo(() => VatCode)
  declare vatCode: BelongsTo<typeof VatCode>
}
