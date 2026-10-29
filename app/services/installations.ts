import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Charge from '#models/charge'
import type ChargeEvent from '#models/charge_event'
import InstalledEquipment from '#models/installed_equipment'
import Item from '#models/item'
import type Visit from '#models/visit'

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
   * equipment at the Job's Site, installed on the Visit's day, or updates
   * the unit it goes onto. A Charge done again reuses the equipment it
   * created, if that still exists, unchanged. Runs inside the caller's
   * transaction, with the Visit, its Job and the Charge locked; the
   * equipment is locked after them.
   */
  static async install(
    trx: TransactionClientContract,
    charge: Charge,
    visit: Visit,
    siteId: number | null
  ): Promise<void> {
    if (charge.kind !== 'item' || !charge.installed) return
    const item = await Item.findOrFail(charge.itemId, { client: trx })
    const day = visit.startsAt.startOf('day')
    const equipment = charge.installedEquipmentId
      ? await InstalledEquipment.query({ client: trx })
          .where('id', charge.installedEquipmentId)
          .forUpdate()
          .first()
      : null

    // Created by this Charge when it was done before: managed by hand since
    if (equipment && charge.createdEquipment) return

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
      return
    }

    // Recorded with a Site, but the Job no longer has one: nowhere to install
    if (!siteId) return
    const created = await InstalledEquipment.create(
      {
        siteId,
        itemId: item.id,
        equipmentType: (charge.equipmentType || item.description).slice(0, 100),
        make: charge.equipmentMake,
        model: charge.equipmentModel,
        serialNumber: charge.equipmentSerialNumber,
        installedOn: day,
        maintenanceIntervalMonths: item.maintenanceIntervalMonths,
      },
      { client: trx }
    )
    await Charge.query({ client: trx })
      .where('id', charge.id)
      .update({ installed_equipment_id: created.id, created_equipment: true })
    charge.installedEquipmentId = created.id
    charge.createdEquipment = true
  }

  /**
   * The equipment the Charge created or updated when it was done, which
   * marking it not done, removing it or correcting its Item leaves as it
   * is: Office is warned, naming it. Null if the Charge was never done
   * (its equipment was never touched) or the equipment is gone. `events`
   * is the Charge's history.
   */
  static async left(
    trx: TransactionClientContract,
    charge: Charge,
    events: ChargeEvent[]
  ): Promise<InstalledEquipment | null> {
    if (charge.kind !== 'item' || !charge.installed || !charge.installedEquipmentId) return null
    if (!events.some((event) => event.kind === 'done')) return null
    return InstalledEquipment.find(charge.installedEquipmentId, { client: trx })
  }
}
