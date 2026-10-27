import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { InstalledEquipmentSchema } from '#database/schema'
import Site from '#models/site'

/**
 * A specific piece of equipment installed at a Site, which outlives
 * changes of Customer.
 */
export default class InstalledEquipment extends InstalledEquipmentSchema {
  static table = 'installed_equipment'

  @belongsTo(() => Site)
  declare site: BelongsTo<typeof Site>

  /**
   * When the next periodic check is due: the Maintenance Interval after
   * the last service, or after installation if it has never been serviced.
   * Null without an interval or a date to count from.
   */
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
