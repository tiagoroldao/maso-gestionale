import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Item from '#models/item'
import LabourRate from '#models/labour_rate'
import type User from '#models/user'
import Visit, { type VisitStatus } from '#models/visit'
import VisitHour from '#models/visit_hour'
import VisitItem from '#models/visit_item'
import InstalledEquipment from '#models/installed_equipment'
import StockLedger from '#stock/stock_ledger'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'

export { CLOSED_VISIT_STATUSES } from '#shared/visits'

/**
 * The Visit is closed (its hours, Items and stock are final), or the
 * request doesn't fit it (a Technician not on the Visit, an install
 * without a Site).
 */
export class FieldWorkRefusedError extends Error {
  constructor(readonly reason: 'done' | 'notOnVisit' | 'noSite') {
    super(reason)
  }
}

/**
 * What Technicians record on a Visit: hours, Items used (some installed at
 * the Site) and closing it, which takes the Items off stock. Every change
 * locks the Visit, so a colleague closing it at the same moment can't
 * leave lines off stock or reopen it.
 */
export default class FieldWork {
  static async recordHours(
    visit: Visit,
    input: { technicianId: number; labourRateId: number; hours: string }
  ) {
    return this.whileOpen(visit, async (trx) => {
      if (!(await this.isOnVisit(trx, visit.id, input.technicianId))) {
        throw new FieldWorkRefusedError('notOnVisit')
      }
      const rate = await LabourRate.findOrFail(input.labourRateId, { client: trx })
      return VisitHour.create(
        {
          visitId: visit.id,
          userId: input.technicianId,
          labourRateId: rate.id,
          hours: input.hours,
          // Priced when the work is recorded; later rate changes don't apply
          unitPrice: rate.hourlyPrice,
        },
        { client: trx }
      )
    })
  }

  static async removeHours(hour: VisitHour) {
    await this.whileOpen(await Visit.findOrFail(hour.visitId), async (trx) => {
      await VisitHour.query({ client: trx }).where('id', hour.id).delete()
    })
  }

  /**
   * Records an Item used; an installed one becomes Installed Equipment at
   * the Job's Site, linked to the Item, with its default interval.
   */
  static async recordItem(
    visit: Visit,
    input: { itemId: number; quantity: string; installed?: boolean; serialNumber?: string | null }
  ) {
    return this.whileOpen(visit, async (trx, locked) => {
      await locked.load('job')
      if (input.installed && !locked.job.siteId) throw new FieldWorkRefusedError('noSite')

      const item = await Item.findOrFail(input.itemId, { client: trx })
      let equipmentId: number | null = null
      if (input.installed) {
        const equipment = await InstalledEquipment.create(
          {
            siteId: locked.job.siteId!,
            itemId: item.id,
            equipmentType: item.description.slice(0, 100),
            serialNumber: input.serialNumber ?? null,
            installedOn: locked.startsAt.startOf('day'),
            maintenanceIntervalMonths: item.maintenanceIntervalMonths,
          },
          { client: trx }
        )
        equipmentId = equipment.id
      }

      return VisitItem.create(
        {
          visitId: visit.id,
          itemId: item.id,
          quantity: input.quantity,
          unitPrice: item.resalePrice,
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
    await this.whileOpen(await Visit.findOrFail(line.visitId), async (trx) => {
      const current = await VisitItem.query({ client: trx }).where('id', line.id).first()
      if (!current) return
      // Already off stock: the line is part of the record
      if (current.stockMovementId) throw new FieldWorkRefusedError('done')
      await current.useTransaction(trx).delete()
      if (current.installedEquipmentId) {
        await InstalledEquipment.query({ client: trx })
          .where('id', current.installedEquipmentId)
          .delete()
      }
    })
  }

  /**
   * Changes the Visit's status. Closing it (done, or needs another visit)
   * takes every Item used off stock in the same transaction; a closed
   * Visit's status no longer changes.
   */
  static async setStatus(visit: Visit, status: VisitStatus, user: User) {
    await this.whileOpen(visit, async (trx, locked) => {
      if (CLOSED_VISIT_STATUSES.includes(status)) {
        await locked.load('job')
        await locked.load('items', (items) => items.whereNull('stock_movement_id').preload('item'))
        for (const line of locked.items) {
          const movement = await StockLedger.use(line.item, {
            quantity: line.quantity,
            occurredOn: locked.startsAt.startOf('day'),
            reference: locked.job.number,
            user,
            client: trx,
          })
          await VisitItem.query({ client: trx })
            .where('id', line.id)
            .update({ stock_movement_id: movement.id })
        }
      }

      locked.status = status
      await locked.save()
    })
    visit.status = status
  }

  /**
   * Runs `work` with the Visit locked and re-read, refusing if it is
   * already closed.
   */
  private static whileOpen<T>(
    visit: Visit,
    work: (trx: TransactionClientContract, locked: Visit) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      const locked = await Visit.query({ client: trx })
        .where('id', visit.id)
        .forUpdate()
        .firstOrFail()
      if (CLOSED_VISIT_STATUSES.includes(locked.status)) throw new FieldWorkRefusedError('done')
      return work(trx, locked)
    })
  }

  private static async isOnVisit(trx: TransactionClientContract, visitId: number, userId: number) {
    const row = await trx
      .from('visit_technicians')
      .where('visit_id', visitId)
      .where('user_id', userId)
      .first()
    return Boolean(row)
  }
}
