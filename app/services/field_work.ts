import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Item from '#models/item'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
import User from '#models/user'
import Visit, { type FieldVisitStatus } from '#models/visit'
import Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import InstalledEquipment from '#models/installed_equipment'
import Installations, { type EquipmentWarning } from '#services/installations'
import StockLedger from '#stock/stock_ledger'
import { CLOSED_VISIT_STATUSES, isCancelledVisit } from '#shared/visits'
import { CHARGE_DESCRIPTION_MAX } from '#shared/charges'

export { CLOSED_VISIT_STATUSES } from '#shared/visits'

/**
 * The Visit is closed (its hours, Items and stock are final) or cancelled
 * (read-only until Office restores it, #157), its Job was
 * closed or cancelled (or, for Office closing a frozen Visit, isn't
 * cancelled), or the request doesn't fit it (a Technician not on
 * the Visit, an install without a Site, a Charge Office already reviewed).
 */
export class FieldWorkRefusedError extends Error {
  constructor(
    readonly reason:
      | 'done'
      | 'visitCancelled'
      | 'closed'
      | 'cancelled'
      | 'notCancelled'
      | 'notOnVisit'
      | 'noSite'
      | 'notAtSite'
      | 'reviewed'
  ) {
    super(reason)
  }
}

/**
 * What Technicians record on a Visit: hours and Items used (some installed
 * at the Site), as Charges (ADR 0010) planned until the Visit closes, notes and photos,
 * and closing it, which reviews the Charges, takes the done Items off
 * stock and installs the done installed ones (ADR 0016, #162). Every
 * change locks the Visit, so a colleague closing it at the same moment
 * can't leave lines off stock or reopen it.
 *
 * A closed or cancelled Job's Visits are frozen as history: they leave the
 * Agenda and the Technicians' lists, and accept no further work (ADR
 * 0015); a closed Job is reopened first. The one exception: Office marks
 * done a Visit left open on a cancelled Job (closeOnCancelledJob, #153).
 */
export default class FieldWork {
  /**
   * Runs `work` (adding a note or photo) while the Visit's Job is active.
   * Notes and photos may still go on a closed Visit (a follow-up remark, a
   * forgotten picture), but not on a cancelled one, nor once its Job is
   * closed or cancelled; the Visit and Job are share-locked so none can
   * slip in between check and write.
   */
  static whileJobActive<T>(visit: Visit, work: (trx: TransactionClientContract) => Promise<T>) {
    return db.transaction(async (trx) => {
      // Visit first, then its Job: the order every other path uses
      const locked = await Visit.query({ client: trx })
        .where('id', visit.id)
        .forShare()
        .firstOrFail()
      if (isCancelledVisit(locked.status)) throw new FieldWorkRefusedError('visitCancelled')
      await this.lockActiveJob(trx, visit.jobId)
      return work(trx)
    })
  }

  /**
   * Share-locks the Job, refusing if it is closed or cancelled. Lock order is always
   * the Visit first, then its Job: code that locks a Job and then its
   * Visits must not run concurrently with field work, or it deadlocks.
   */
  private static async lockActiveJob(trx: TransactionClientContract, jobId: number) {
    const job = await Job.query({ client: trx }).where('id', jobId).forShare().firstOrFail()
    if (job.status === 'closed' || job.status === 'cancelled') {
      throw new FieldWorkRefusedError(job.status)
    }
  }

  /**
   * Records hours worked by a Technician on the Visit, or by someone
   * outside the app (a contractor hired for the day), as a Charge priced
   * at the Labour Rate.
   */
  static async recordHours(
    visit: Visit,
    input: {
      technicianId?: number | null
      workerName?: string | null
      labourRateId: number
      hours: string
    },
    recordedBy: User | null = null
  ) {
    return this.whileOpen(visit, async (trx, locked) => {
      let worker = input.workerName?.trim() || null
      if (input.technicianId) {
        if (!(await this.isOnVisit(trx, visit.id, input.technicianId))) {
          throw new FieldWorkRefusedError('notOnVisit')
        }
        const technician = await User.findOrFail(input.technicianId, { client: trx })
        worker = technician.fullName ?? technician.email
      }
      if (!worker) throw new FieldWorkRefusedError('notOnVisit')
      const rate = await LabourRate.findOrFail(input.labourRateId, { client: trx })
      return this.record(trx, recordedBy, {
        jobId: locked.jobId,
        visitId: locked.id,
        kind: 'labour',
        userId: input.technicianId || null,
        workerName: input.technicianId ? null : worker,
        labourRateId: rate.id,
        quantity: input.hours,
        billQuantity: input.hours,
        // Priced when the work is recorded; later rate changes don't apply
        unitPrice: rate.hourlyPrice,
        description: labourDescription(rate.name, worker),
      })
    })
  }

  /**
   * Removes a Charge recorded by mistake, while the Visit is open and
   * before Office has acted on it (an imported Quote line is Office's).
   * Never done, it never touched Installed Equipment (#162).
   */
  static async removeCharge(charge: Charge) {
    await this.whileOpen(await Visit.findOrFail(charge.visitId), async (trx) => {
      const current = await Charge.query({ client: trx }).where('id', charge.id).forUpdate().first()
      if (!current) return
      // Already off stock: the Charge is part of the record
      if (current.stockMovementId) throw new FieldWorkRefusedError('done')
      // Office put it there from the Quote (ADR 0012), or acted on it since
      const reviewed =
        current.quoteLineId !== null ||
        (await ChargeEvent.query({ client: trx })
          .where('chargeId', current.id)
          .whereNot('kind', 'recorded')
          .first())
      if (reviewed) throw new FieldWorkRefusedError('reviewed')
      await current.useTransaction(trx).delete()
    })
  }

  /**
   * Creates a Charge with its "recorded" event.
   */
  private static async record(
    trx: TransactionClientContract,
    recordedBy: User | null,
    values: Partial<Charge>
  ) {
    const charge = await Charge.create(values, { client: trx })
    await ChargeEvent.create(
      { chargeId: charge.id, kind: 'recorded', userId: recordedBy?.id ?? null },
      { client: trx }
    )
    return charge
  }

  /**
   * Records an Item used. An installed one keeps the equipment's details
   * on the Charge (a new unit's type, make, model and serial number, or
   * the unit at the Job's Site it goes onto) until it becomes done, when
   * the equipment is created or updated (Installations, #162).
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
    },
    recordedBy: User | null = null
  ) {
    return this.whileOpen(visit, async (trx, locked) => {
      await locked.load('job')
      if (input.installed && !locked.job.siteId) throw new FieldWorkRefusedError('noSite')

      const item = await Item.findOrFail(input.itemId, { client: trx })
      let equipmentId: number | null = null
      if (input.installed && input.equipmentId) {
        // Onto equipment already registered at this Site, still there
        const existing = await InstalledEquipment.query({ client: trx })
          .where('id', input.equipmentId)
          .where('siteId', locked.job.siteId!)
          .whereNull('removedOn')
          .first()
        if (!existing) throw new FieldWorkRefusedError('notAtSite')
        equipmentId = existing.id
      }
      const newUnit = input.installed && !equipmentId

      return this.record(trx, recordedBy, {
        jobId: locked.jobId,
        visitId: locked.id,
        kind: 'item',
        itemId: item.id,
        quantity: input.quantity,
        installed: Boolean(input.installed),
        installedEquipmentId: equipmentId,
        equipmentType: newUnit ? input.equipmentType || null : null,
        equipmentMake: newUnit ? input.make || null : null,
        equipmentModel: newUnit ? input.model || null : null,
        equipmentSerialNumber: input.installed ? input.serialNumber || null : null,
        billQuantity: input.quantity,
        // The Item's resale price when recorded
        unitPrice: item.resalePrice,
        description: item.description.slice(0, CHARGE_DESCRIPTION_MAX),
      })
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
            .orderBy('id')
            // Locked so a concurrent removal can't slip in before the insert
            .forShare()
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
   * is the review of its Charges (ADR 0016): each becomes done, an Item
   * leaving stock and an installed one creating or updating its equipment
   * (#162) in the same transaction, except those in `notDone` (unticked in
   * the review), which become not done and touch neither. A closed
   * Visit's status no longer changes. Returns the warnings about equipment
   * that changed since it was recorded (#168).
   */
  static async setStatus(
    visit: Visit,
    status: FieldVisitStatus,
    user: User,
    notDone: number[] = []
  ): Promise<EquipmentWarning[]> {
    const warnings = await this.whileOpen(visit, (trx, locked) =>
      this.changeStatus(trx, locked, status, user, notDone)
    )
    visit.status = status
    return warnings
  }

  /**
   * Office marks done a Visit left open when its Job was cancelled (#153),
   * reviewing its Charges as the field does (`notDone`, ADR 0016), so its
   * done Items come off stock, its done installed Items create or update
   * their equipment (#162), its serviced equipment is dated and its
   * done Charges become billable (#111), as when any Visit closes. Only
   * "done": nobody goes back on a cancelled Job. Refused once the Visit is
   * closed, and on any Job not cancelled: an active Job's Visits close in
   * the field, a closed Job is reopened first. Returns the warnings about
   * equipment, as `setStatus`.
   */
  static async closeOnCancelledJob(
    visit: Visit,
    user: User,
    notDone: number[] = []
  ): Promise<EquipmentWarning[]> {
    const warnings = await db.transaction(async (trx) => {
      const locked = await this.lockOpenVisit(trx, visit)
      // Visit first, then its Job; cancelled is final, so a share lock holds it
      const job = await Job.query({ client: trx })
        .where('id', locked.jobId)
        .forShare()
        .firstOrFail()
      if (job.status !== 'cancelled') {
        throw new FieldWorkRefusedError(job.status === 'closed' ? 'closed' : 'notCancelled')
      }
      return this.changeStatus(trx, locked, 'done', user, notDone)
    })
    visit.status = 'done'
    return warnings
  }

  /**
   * Sets the locked Visit's status; closing it makes its planned Charges
   * done (Items off stock, installed ones installed) or, for those in
   * `notDone`, not done, and dates the equipment it serviced. Returns the
   * warnings about the equipment its installed Items went onto (#168).
   */
  private static async changeStatus(
    trx: TransactionClientContract,
    locked: Visit,
    status: FieldVisitStatus,
    user: User,
    notDone: number[]
  ): Promise<EquipmentWarning[]> {
    const warnings: EquipmentWarning[] = []
    if (CLOSED_VISIT_STATUSES.includes(status)) {
      await locked.load('job')
      // Locked after the Visit and its Job, as Office's changes do
      const charges = await Charge.query({ client: trx })
        .where('visitId', locked.id)
        .preload('events', (events) => events.orderBy('id'))
        .preload('item')
        .orderBy('id')
        .forUpdate()
      for (const charge of charges) {
        if (charge.workState !== 'planned') continue
        const done = !notDone.includes(charge.id)
        await ChargeEvent.create(
          { chargeId: charge.id, kind: done ? 'done' : 'not_done', userId: user.id },
          { client: trx }
        )
        if (!done || charge.kind !== 'item') continue
        warnings.push(...(await Installations.install(trx, charge, locked, locked.job.siteId)))
        if (charge.stockMovementId) continue
        const movement = await StockLedger.use(charge.item, {
          quantity: charge.quantity,
          occurredOn: locked.startsAt.startOf('day'),
          reference: locked.job.number,
          user,
          client: trx,
        })
        await Charge.query({ client: trx })
          .where('id', charge.id)
          .update({ stock_movement_id: movement.id })
      }

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
    return warnings
  }

  /**
   * Locks and re-reads the Visit, refusing if it is already closed, or
   * cancelled (#157).
   */
  private static async lockOpenVisit(trx: TransactionClientContract, visit: Visit) {
    const locked = await Visit.query({ client: trx })
      .where('id', visit.id)
      .forUpdate()
      .firstOrFail()
    if (CLOSED_VISIT_STATUSES.includes(locked.status)) throw new FieldWorkRefusedError('done')
    if (isCancelledVisit(locked.status)) throw new FieldWorkRefusedError('visitCancelled')
    return locked
  }

  /**
   * Runs `work` with the Visit locked and re-read, refusing if it is
   * already closed or cancelled, or its Job is closed or cancelled.
   */
  private static whileOpen<T>(
    visit: Visit,
    work: (trx: TransactionClientContract, locked: Visit) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      const locked = await this.lockOpenVisit(trx, visit)
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

/**
 * A labour Charge's description: the Labour Rate and who worked.
 */
export function labourDescription(rate: string, worker: string) {
  return `${rate} – ${worker}`.slice(0, CHARGE_DESCRIPTION_MAX)
}
