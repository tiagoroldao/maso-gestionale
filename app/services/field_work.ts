import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Item from '#models/item'
import Job from '#models/job'
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
 * The Visit is closed (its hours, Items and stock are final), its Job was
 * cancelled, or the request doesn't fit it (a Technician not on the
 * Visit, an install without a Site).
 */
export class FieldWorkRefusedError extends Error {
  constructor(readonly reason: 'done' | 'cancelled' | 'notOnVisit' | 'noSite' | 'notAtSite') {
    super(reason)
  }
}

/**
 * What Technicians record on a Visit: hours, Items used (some installed at
 * the Site), notes and photos, and closing it, which takes the Items off
 * stock. Every change locks the Visit, so a colleague closing it at the
 * same moment can't leave lines off stock or reopen it.
 *
 * A cancelled Job's Visits are frozen as history: they leave the Agenda
 * and the Technicians' lists, and accept no further work.
 */
export default class FieldWork {
  /**
   * Runs `work` (adding a note or photo) while the Visit's Job is active.
   * Notes and photos may still go on a closed Visit (a follow-up remark, a
   * forgotten picture), but not once its Job is cancelled; the Job is
   * share-locked so a cancellation can't slip in between check and write.
   */
  static whileJobActive<T>(visit: Visit, work: (trx: TransactionClientContract) => Promise<T>) {
    return db.transaction(async (trx) => {
      // Visit first, then its Job: the order every other path uses
      await Visit.query({ client: trx }).where('id', visit.id).forShare().firstOrFail()
      await this.lockActiveJob(trx, visit.jobId)
      return work(trx)
    })
  }

  /**
   * Share-locks the Job, refusing if it is cancelled. Lock order is always
   * the Visit first, then its Job: code that locks a Job and then its
   * Visits must not run concurrently with field work, or it deadlocks.
   */
  private static async lockActiveJob(trx: TransactionClientContract, jobId: number) {
    const job = await Job.query({ client: trx }).where('id', jobId).forShare().firstOrFail()
    if (job.status === 'cancelled') throw new FieldWorkRefusedError('cancelled')
  }

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
    input: {
      itemId: number
      quantity: string
      installed?: boolean
      serialNumber?: string | null
      equipmentId?: number | null
      equipmentType?: string | null
      make?: string | null
      model?: string | null
    }
  ) {
    return this.whileOpen(visit, async (trx, locked) => {
      await locked.load('job')
      if (input.installed && !locked.job.siteId) throw new FieldWorkRefusedError('noSite')

      const item = await Item.findOrFail(input.itemId, { client: trx })
      let equipmentId: number | null = null
      let created = false
      if (input.installed && input.equipmentId) {
        // Installed onto equipment already registered at this Site
        const existing = await InstalledEquipment.query({ client: trx })
          .where('id', input.equipmentId)
          .where('siteId', locked.job.siteId!)
          .whereNull('removedOn')
          .forUpdate()
          .first()
        if (!existing) throw new FieldWorkRefusedError('notAtSite')
        existing.merge({
          itemId: item.id,
          serialNumber: input.serialNumber ?? existing.serialNumber,
          installedOn: existing.installedOn ?? locked.startsAt.startOf('day'),
          maintenanceIntervalMonths:
            existing.maintenanceIntervalMonths ?? item.maintenanceIntervalMonths,
        })
        await existing.useTransaction(trx).save()
        equipmentId = existing.id
      } else if (input.installed) {
        const equipment = await InstalledEquipment.create(
          {
            siteId: locked.job.siteId!,
            itemId: item.id,
            equipmentType: (input.equipmentType || item.description).slice(0, 100),
            make: input.make ?? null,
            model: input.model ?? null,
            serialNumber: input.serialNumber ?? null,
            installedOn: locked.startsAt.startOf('day'),
            maintenanceIntervalMonths: item.maintenanceIntervalMonths,
          },
          { client: trx }
        )
        equipmentId = equipment.id
        created = true
      }

      return VisitItem.create(
        {
          visitId: visit.id,
          itemId: item.id,
          quantity: input.quantity,
          unitPrice: item.resalePrice,
          installed: Boolean(input.installed),
          installedEquipmentId: equipmentId,
          createdEquipment: created,
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
      // Only equipment this line created goes with it; linked equipment stays
      if (current.installedEquipmentId && current.createdEquipment) {
        await InstalledEquipment.query({ client: trx })
          .where('id', current.installedEquipmentId)
          .delete()
      }
    })
  }

  /**
   * Records which of the Site's current equipment the Visit serviced
   * (replacing the previous choice). Their service date is set when the
   * Visit is closed.
   */
  static async setServiced(visit: Visit, equipmentIds: number[]) {
    await this.whileOpen(visit, async (trx, locked) => {
      await locked.load('job')
      const found = equipmentIds.length
        ? await InstalledEquipment.query({ client: trx })
            .whereIn('id', equipmentIds)
            .where('siteId', locked.job.siteId ?? 0)
            .whereNull('removedOn')
        : []
      const ids = found.map((equipment) => equipment.id)
      if (ids.length !== equipmentIds.length) throw new FieldWorkRefusedError('notAtSite')
      await trx.from('visit_serviced_equipment').where('visit_id', locked.id).delete()
      if (ids.length) {
        await trx
          .table('visit_serviced_equipment')
          .insert(ids.map((id) => ({ visit_id: locked.id, installed_equipment_id: id })))
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

      if (CLOSED_VISIT_STATUSES.includes(status)) {
        // Serviced equipment was serviced on the Visit's day (never moved back)
        const day = locked.startsAt.toISODate()!
        await trx
          .from('installed_equipment')
          .whereIn(
            'id',
            trx
              .from('visit_serviced_equipment')
              .where('visit_id', locked.id)
              .select('installed_equipment_id')
          )
          .where((q) => q.whereNull('last_serviced_on').orWhere('last_serviced_on', '<', day))
          .update({ last_serviced_on: day })
      }

      locked.status = status
      await locked.save()
    })
    visit.status = status
  }

  /**
   * Runs `work` with the Visit locked and re-read, refusing if it is
   * already closed or its Job is cancelled.
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
      // Shared lock: cancelling the Job (an update lock) waits for this work
      await this.lockActiveJob(trx, locked.jobId)
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
