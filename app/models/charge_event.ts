import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { ChargeEventSchema } from '#database/schema'
import Invoice from '#models/invoice'
import User from '#models/user'
import type { ChargeEventKind } from '#shared/charges'

/**
 * What changed in a Charge, as the values shown to Office.
 */
export type ChargeChanges = {
  before: Record<string, string | null>
  after: Record<string, string | null>
}

/**
 * One step in a Charge's history (ADR 0010). Never changed once written.
 * A "billed" event names the Invoice and line that billed the Charge and
 * its part of the line's amount; an "unbilled" one, the Invoice whose
 * billing it undoes.
 */
export default class ChargeEvent extends ChargeEventSchema {
  static table = 'charge_events'

  declare kind: ChargeEventKind
  declare changes: ChargeChanges | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>
}
