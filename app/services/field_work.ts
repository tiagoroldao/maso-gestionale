import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Item from '#models/item'
import type User from '#models/user'
import Visit from '#models/visit'
import VisitHour from '#models/visit_hour'
import VisitItem from '#models/visit_item'
import InstalledEquipment from '#models/installed_equipment'
import StockLedger from '#stock/stock_ledger'

/**
 * The Visit is done (its hours, Items and stock are final), or the request
 * doesn't fit it (a Technician not on the Visit, an install without a Site).
 */
export class FieldWorkRefusedError extends Error {
  constructor(readonly reason: 'done' | 'notOnVisit' | 'noSite') {
    super(reason)
  }
}

/**
 * What Technicians record on a Visit: hours, Items used (some installed at
 * the Site) and completion, which takes the Items off stock.
 */
export default class FieldWork {
  static async recordHours(
    visit: Visit,
    input: { technicianId: number; labourRateId: number; hours: string }
  ) {
    this.assertOpen(visit)
    if (!(await this.isOnVisit(visit, input.technicianId))) {
      throw new FieldWorkRefusedError('notOnVisit')
    }
    return VisitHour.create({
      visitId: visit.id,
      userId: input.technicianId,
      labourRateId: input.labourRateId,
      hours: input.hours,
    })
  }

  static async removeHours(hour: VisitHour) {
    this.assertOpen(await Visit.findOrFail(hour.visitId))
    await hour.delete()
  }

  /**
   * Records an Item used; an installed one becomes Installed Equipment at
   * the Job's Site, linked to the Item, with its default interval.
   */
  static async recordItem(
    visit: Visit,
    input: { itemId: number; quantity: string; installed?: boolean; serialNumber?: string | null }
  ) {
    this.assertOpen(visit)
    await visit.load('job')
    if (input.installed && !visit.job.siteId) throw new FieldWorkRefusedError('noSite')

    return db.transaction(async (trx) => {
      let equipmentId: number | null = null
      if (input.installed) {
        const item = await Item.findOrFail(input.itemId, { client: trx })
        const equipment = await InstalledEquipment.create(
          {
            siteId: visit.job.siteId!,
            itemId: item.id,
            equipmentType: item.description.slice(0, 100),
            serialNumber: input.serialNumber ?? null,
            installedOn: visit.startsAt.startOf('day'),
            maintenanceIntervalMonths: item.maintenanceIntervalMonths,
          },
          { client: trx }
        )
        equipmentId = equipment.id
      }

      return VisitItem.create(
        {
          visitId: visit.id,
          itemId: input.itemId,
          quantity: input.quantity,
          installed: Boolean(input.installed),
          installedEquipmentId: equipmentId,
        },
        { client: trx }
      )
    })
  }

  /**
   * Removes an Item line, and the Installed Equipment it created.
   */
  static async removeItem(line: VisitItem) {
    this.assertOpen(await Visit.findOrFail(line.visitId))
    await db.transaction(async (trx) => {
      line.useTransaction(trx)
      const equipmentId = line.installedEquipmentId
      await line.delete()
      if (equipmentId)
        await InstalledEquipment.query({ client: trx }).where('id', equipmentId).delete()
    })
  }

  /**
   * Marks the Visit done and takes every Item used off stock, in one
   * transaction. A done Visit's hours and Items no longer change.
   */
  static async complete(visit: Visit, user: User) {
    await db.transaction(async (trx) => {
      const locked = await Visit.query({ client: trx })
        .where('id', visit.id)
        .forUpdate()
        .preload('items', (items) => items.whereNull('stock_movement_id').preload('item'))
        .firstOrFail()
      if (locked.status === 'done') return

      for (const line of locked.items) {
        const movement = await StockLedger.use(line.item, {
          quantity: line.quantity,
          occurredOn: DateTime.now(),
          reference: `Intervento #${locked.id}`,
          user,
          client: trx,
        })
        await VisitItem.query({ client: trx })
          .where('id', line.id)
          .update({ stock_movement_id: movement.id })
      }

      locked.useTransaction(trx)
      locked.status = 'done'
      await locked.save()
    })
    visit.status = 'done'
  }

  private static assertOpen(visit: Visit) {
    if (visit.status === 'done') throw new FieldWorkRefusedError('done')
  }

  private static async isOnVisit(visit: Visit, userId: number) {
    const row = await db
      .from('visit_technicians')
      .where('visit_id', visit.id)
      .where('user_id', userId)
      .first()
    return Boolean(row)
  }
}
