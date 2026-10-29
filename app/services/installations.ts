import type { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { I18n } from '@adonisjs/i18n'
import Charge from '#models/charge'
import type ChargeEvent from '#models/charge_event'
import InstalledEquipment from '#models/installed_equipment'
import Item from '#models/item'
import type Visit from '#models/visit'

/**
 * Why an installed Item's equipment needs a look by hand, naming it (its
 * description): Office, or the Technician closing the Visit, is warned,
 * never refused (#162, #168).
 *
 * - `left`: the Charge stopped being done or changed Item, and the
 *   equipment it installed was left as it was;
 * - `removed`: the unit it went onto was marked removed since it was
 *   recorded, and was updated all the same (it stays removed);
 * - `elsewhere`: the unit it went onto is no longer at the Job's Site (the
 *   Job's Site changed or was cleared), and was updated all the same;
 * - `noSite`: the new unit wasn't created, the Job no longer having a Site.
 */
export type EquipmentWarning = {
  reason: 'left' | 'removed' | 'elsewhere' | 'noSite'
  equipment: string
}

/**
 * Installed Equipment follows what actually happened (#162, ADR 0016). An
 * installed Item's Charge keeps the equipment's details while it is
 * planned or not done: a new unit's type, make, model and serial number,
 * or the unit already at the Site it goes onto. Only when the Charge
 * becomes done (its Visit closing, or Office marking it done) is the
 * equipment created or updated. After that it is managed by hand: marking
 * the Charge not done, removing it or correcting its Item leave the
 * equipment as it is, and Office is warned instead.
 */
export default class Installations {
  /**
   * The installed Item's Charge became done on `visit`: creates its new
   * equipment at the Job's Site, installed on the Visit's work day
   * (`Visit.workDay`, #174), or updates the unit it goes onto. A Charge done again reuses the equipment it
   * created, if that still exists, unchanged. Runs inside the caller's
   * transaction, with the Visit, its Job and the Charge locked; the
   * equipment is locked after them. Returns what changed since the Charge
   * was recorded, for a warning: the unit removed or no longer at the
   * Job's Site (still updated), or no Site left to create the new one at.
   * `now` is the caller's moment, so its other dates fall on the same work
   * day even across midnight.
   */
  static async install(
    trx: TransactionClientContract,
    charge: Charge,
    visit: Visit,
    siteId: number | null,
    now: DateTime
  ): Promise<EquipmentWarning[]> {
    if (charge.kind !== 'item' || !charge.installed) return []
    const item = await Item.findOrFail(charge.itemId, { client: trx })
    const day = visit.workDay(now)
    const equipment = charge.installedEquipmentId
      ? await InstalledEquipment.query({ client: trx })
          .where('id', charge.installedEquipmentId)
          .forUpdate()
          .first()
      : null

    // Created by this Charge when it was done before: managed by hand since
    if (equipment && charge.createdEquipment) return []

    if (equipment) {
      // Installed onto equipment already registered at the Site
      equipment.merge({
        itemId: item.id,
        serialNumber: charge.equipmentSerialNumber ?? equipment.serialNumber,
        installedOn: equipment.installedOn ?? day,
        maintenanceIntervalMonths:
          equipment.maintenanceIntervalMonths ?? item.maintenanceIntervalMonths,
      })
      await equipment.useTransaction(trx).save()
      // Recorded onto a unit at the Job's Site that wasn't removed
      const warnings: EquipmentWarning[] = []
      if (equipment.removedOn) {
        warnings.push({ reason: 'removed', equipment: equipment.description })
      }
      if (equipment.siteId !== siteId) {
        warnings.push({ reason: 'elsewhere', equipment: equipment.description })
      }
      return warnings
    }

    const details = new InstalledEquipment().merge({
      itemId: item.id,
      equipmentType: (charge.equipmentType || item.description).slice(0, 100),
      make: charge.equipmentMake,
      model: charge.equipmentModel,
      serialNumber: charge.equipmentSerialNumber,
      installedOn: day,
      maintenanceIntervalMonths: item.maintenanceIntervalMonths,
    })
    // Recorded with a Site, but the Job no longer has one: nowhere to install
    if (!siteId) return [{ reason: 'noSite', equipment: details.description }]
    const created = await details.merge({ siteId }).useTransaction(trx).save()
    await Charge.query({ client: trx })
      .where('id', charge.id)
      .update({ installed_equipment_id: created.id, created_equipment: true })
    charge.installedEquipmentId = created.id
    charge.createdEquipment = true
    return []
  }

  /**
   * The equipment the Charge created or updated when it was done, which
   * marking it not done or correcting its Item leaves as it is: Office is
   * warned, naming it. None if the Charge was never done (its equipment
   * was never touched) or the equipment is gone. `events` is the Charge's
   * history.
   */
  static async left(
    trx: TransactionClientContract,
    charge: Charge,
    events: ChargeEvent[]
  ): Promise<EquipmentWarning[]> {
    if (charge.kind !== 'item' || !charge.installed || !charge.installedEquipmentId) return []
    if (!events.some((event) => event.kind === 'done')) return []
    const equipment = await InstalledEquipment.find(charge.installedEquipmentId, { client: trx })
    return equipment ? [{ reason: 'left', equipment: equipment.description }] : []
  }

  /**
   * The warnings as flash sentences, in order.
   */
  static messages(i18n: I18n, warnings: EquipmentWarning[]): string[] {
    return warnings.map(({ reason, equipment }) =>
      i18n.t(`flash.equipmentWarning.${reason}`, { equipment })
    )
  }
}
