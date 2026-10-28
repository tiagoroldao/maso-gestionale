import { belongsTo, hasMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { ChargeSchema } from '#database/schema'
import ChargeEvent from '#models/charge_event'
import Invoice from '#models/invoice'
import Item from '#models/item'
import LabourRate from '#models/labour_rate'
import User from '#models/user'
import { chargeState, type ChargeKind } from '#shared/charges'
import { lineKindOf, type LineKind } from '#shared/vat'
import { NOT_BILLABLE_SQL } from '#services/job_status'

/**
 * Something a Job can be billed for (ADR 0010): hours someone worked at a
 * Labour Rate, an Item used, or another cost Office added to the Job. What
 * was recorded feeds stock; what is billed (quantity, price, description)
 * feeds Invoices.
 */
export default class Charge extends ChargeSchema {
  static table = 'charges'

  declare kind: ChargeKind
  declare vatKind: LineKind | null

  @belongsTo(() => User)
  declare technician: BelongsTo<typeof User>

  @belongsTo(() => LabourRate)
  declare labourRate: BelongsTo<typeof LabourRate>

  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>

  @hasMany(() => ChargeEvent)
  declare events: HasMany<typeof ChargeEvent>

  /**
   * Charges Office hasn't marked not billable.
   */
  static billable = scope((query) => {
    query.whereRaw(`NOT ${NOT_BILLABLE_SQL('charges')}`)
  })

  /**
   * Who worked the hours: an app user or someone outside the app (needs
   * `technician` preloaded). Null for an Item.
   */
  get worker() {
    if (this.kind !== 'labour') return null
    return this.technician ? (this.technician.fullName ?? this.technician.email) : this.workerName
  }

  /**
   * The billed unit: hours, the Item's unit (needs `item` preloaded), or
   * the one Office gave another cost.
   */
  get billUnit() {
    if (this.kind === 'labour') return 'h'
    return this.kind === 'item' ? this.item.unit : this.unit
  }

  /**
   * Which default VAT rule applies when billed (needs `item` preloaded).
   */
  get lineKind(): LineKind {
    if (this.kind === 'other') return this.vatKind!
    return lineKindOf(this.kind === 'item' ? this.item : null)
  }

  /**
   * The state from the history (needs `events` ordered by id and `invoice`
   * preloaded).
   */
  get state() {
    return chargeState(this.events, this.invoice?.status ?? null)
  }
}
