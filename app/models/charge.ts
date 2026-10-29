import { belongsTo, hasMany, manyToMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { ChargeSchema } from '#database/schema'
import ChargeEvent from '#models/charge_event'
import InvoiceLine from '#models/invoice_line'
import Item from '#models/item'
import LabourRate from '#models/labour_rate'
import User from '#models/user'
import { chargeState, workState, type ChargeKind } from '#shared/charges'
import { lineKindOf, type LineKind } from '#shared/vat'
import { CHARGE_STATE_SQL, WORK_STATE_SQL } from '#services/job_status'

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

  @hasMany(() => ChargeEvent)
  declare events: HasMany<typeof ChargeEvent>

  /**
   * The Invoice lines that bill it, hold it (a draft's), or billed it
   * before it was set back to bill. At most one is on a draft.
   */
  @manyToMany(() => InvoiceLine, {
    pivotTable: 'invoice_line_charges',
    pivotTimestamps: { createdAt: 'created_at', updatedAt: false },
  })
  declare invoiceLines: ManyToMany<typeof InvoiceLine>

  /**
   * Charges a draft takes now (isDraftable()): done, billable, neither
   * held by a draft nor billed (ADR 0016).
   */
  static toBill = scope((query) => {
    query
      .whereRaw(`${CHARGE_STATE_SQL('charges')} = 'to_bill'`)
      .whereRaw(`${WORK_STATE_SQL('charges')} = 'done'`)
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
   * The draft Invoice holding it, if any (needs `invoiceLines` preloaded
   * with their `invoice`).
   */
  get heldBy() {
    return this.invoiceLines.find((line) => line.invoice.status === 'draft')?.invoice ?? null
  }

  /**
   * The "billed" event while an issued Invoice bills it, Credit Notes
   * crediting it or not (needs `events` ordered by id).
   */
  get billing() {
    const latest = this.events.findLast(
      (event) => event.kind === 'billed' || event.kind === 'unbilled'
    )
    return latest?.kind === 'billed' ? latest : null
  }

  /**
   * The state from the history (needs `events` ordered by id and
   * `invoiceLines` preloaded with their `invoice`).
   */
  get state() {
    return chargeState(this.events, this.heldBy !== null)
  }

  /**
   * Whether the work happened: planned, done or not done (needs `events`
   * ordered by id; ADR 0016).
   */
  get workState() {
    return workState(this.events)
  }
}
