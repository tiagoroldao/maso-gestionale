import { scope } from '@adonisjs/lucid/orm'
import { VatCodeSchema } from '#database/schema'
import type { NaturaCode } from '#shared/vat'

/**
 * A VAT treatment an Invoice line can carry: a rate, or 0% with the
 * FatturaPA Natura code that explains why. Admin-managed (ADR 0008).
 */
export default class VatCode extends VatCodeSchema {
  declare natura: NaturaCode | null

  static active = scope((query) => {
    query.whereNull('archived_at')
  })
}
