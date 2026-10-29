import type { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { I18n } from '@adonisjs/i18n'
import type Charge from '#models/charge'
import type ChargeEvent from '#models/charge_event'
import InstalledEquipment from '#models/installed_equipment'
import Item from '#models/item'
import type Visit from '#models/visit'
import { equipmentUnits, takesSerialNumber } from '#shared/items'

/**
 * Why an Equipment Item's equipment needs a look by hand, naming it (its
 * description): Office, or the Technician closing the Visit, is warned,
 * never refused (#162, #176).
 *
 * - `left`: the Charge stopped being done or changed Item, and the
 *   equipment it created was left as it was;
 * - `quantity`: the Charge's quantity was corrected, and the equipment it
 *   created was left as it was;
 * - `noSite`: the equipment wasn't created, the Job having no Site.
 */
export type EquipmentWarning = {
  reason: 'left' | 'quantity' | 'noSite'
  equipment: string
}

/**
 * Installed Equipment follows what actually happened (#162, #176, ADR
 * 0016). A Charge of an Equipment Item keeps the equipment's details
 * (type, make, model, and a serial number for a single unit) while it is
 * planned or not done. Only when the Charge becomes done (its Visit
 * closing, or Office marking it done) is the equipment created at the
 * Job's Site, one unit per piece. After that it is managed by hand:
 * marking the Charge not done, removing it or correcting it leave the
 * equipment as it is, and Office is warned instead.
 */
export default class Installations {
  /**
   * The Charge became done on `visit`: if its Item is Equipment, creates
   * its units at the Job's Site, installed on the Visit's work day
   * (`Visit.workDay`, #174). A Charge done again reuses the equipment it
   * created, if any of it still exists, unchanged. Runs inside the
   * caller's transaction, with the Visit, its Job and the Charge locked.
   * Returns a warning when the Job has no Site to create them at. `now` is
   * the caller's moment, so its other dates fall on the same work day even
   * across midnight.
   */
  static async install(
    trx: TransactionClientContract,
    charge: Charge,
    visit: Visit,
    siteId: number | null,
    now: DateTime
  ): Promise<EquipmentWarning[]> {
    if (charge.kind !== 'item') return []
    const item = await Item.findOrFail(charge.itemId, { client: trx })
    if (!item.equipment) return []
    const day = visit.workDay(now)

    // Created by this Charge when it was done before: managed by hand since
    const created = await this.createdBy(trx, charge)
    if (created.length) return []

    const details = {
      itemId: item.id,
      equipmentType: (charge.equipmentType || item.description).slice(0, 100),
      make: charge.equipmentMake,
      model: charge.equipmentModel,
      serialNumber: takesSerialNumber(charge.quantity) ? charge.equipmentSerialNumber : null,
      installedOn: day,
      maintenanceIntervalMonths: item.maintenanceIntervalMonths,
    }
    if (!siteId) {
      const unit = new InstalledEquipment().merge(details)
      return [{ reason: 'noSite', equipment: unit.description }]
    }
    const units = Array.from({ length: equipmentUnits(charge.quantity) }, () => ({
      ...details,
      siteId,
      chargeId: charge.id,
    }))
    await InstalledEquipment.createMany(units, { client: trx })
    return []
  }

  /**
   * The equipment the Charge created when it was done, which marking it
   * not done or correcting it leaves as it is: Office is warned, naming
   * it, for `reason` ('left' for not done or another Item, 'quantity' for
   * a new quantity). None if the Charge was never done (it created
   * nothing) or the equipment is gone. `events` is the Charge's history.
   */
  static async left(
    trx: TransactionClientContract,
    charge: Charge,
    events: ChargeEvent[],
    reason: 'left' | 'quantity' = 'left'
  ): Promise<EquipmentWarning[]> {
    if (charge.kind !== 'item') return []
    if (!events.some((event) => event.kind === 'done')) return []
    const equipment = await this.createdBy(trx, charge)
    // Several units with the same details are named once
    const names = new Set(equipment.map((unit) => unit.description))
    return [...names].map((name) => ({ reason, equipment: name }))
  }

  /**
   * The warnings as flash sentences, in order.
   */
  static messages(i18n: I18n, warnings: EquipmentWarning[]): string[] {
    return warnings.map(({ reason, equipment }) =>
      i18n.t(`flash.equipmentWarning.${reason}`, { equipment })
    )
  }

  /**
   * The equipment the Charge created, still registered.
   */
  private static createdBy(trx: TransactionClientContract, charge: Charge) {
    return InstalledEquipment.query({ client: trx }).where('chargeId', charge.id).orderBy('id')
  }
}
