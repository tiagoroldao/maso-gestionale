import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { InstalledEquipmentSchema } from '#database/schema'
import Site from '#models/site'
import Item from '#models/item'

/**
 * A specific piece of equipment installed at a Site, which outlives
 * changes of Customer.
 */
export default class InstalledEquipment extends InstalledEquipmentSchema {
  static table = 'installed_equipment'

  @belongsTo(() => Site)
  declare site: BelongsTo<typeof Site>

  /**
   * The Item this equipment was sold as, if any; its documents and default
   * Maintenance Interval apply.
   */
  @belongsTo(() => Item)
  declare item: BelongsTo<typeof Item>

  /**
   * When the next periodic check is due: the Maintenance Interval after
   * the last service, or after installation if it has never been serviced.
   * Null without an interval or a date to count from.
   */
  /**
   * The same due date in SQL, for lists and filters: an expression on the
   * `installed_equipment` table (null without an interval or a date).
   */
  static NEXT_DUE_SQL = `(coalesce(installed_equipment.last_serviced_on, installed_equipment.installed_on)
    + make_interval(months => installed_equipment.maintenance_interval_months))::date`

  get nextDueOn() {
    const from = this.lastServicedOn ?? this.installedOn
    if (!this.maintenanceIntervalMonths || !from) return null
    return from.plus({ months: this.maintenanceIntervalMonths })
  }

  /**
   * "Vaillant ecoTEC plus" style label, falling back to the type.
   */
  get description() {
    const makeAndModel = [this.make, this.model].filter(Boolean).join(' ')
    return makeAndModel ? `${this.equipmentType} — ${makeAndModel}` : this.equipmentType
  }
}
