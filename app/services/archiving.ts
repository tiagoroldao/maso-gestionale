import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Customer from '#models/customer'
import InstalledEquipment from '#models/installed_equipment'
import Site from '#models/site'

/**
 * The Customer or Site still has Jobs that aren't cancelled.
 */
export class HasOpenJobsError extends Error {}

/**
 * The removal doesn't fit: the equipment was already removed, the date is
 * before it was installed, or the replacement isn't current equipment at
 * the same Site.
 */
export class InvalidRemovalError extends Error {}

/**
 * The Customer or Site was archived and can't take new work.
 */
export class ArchivedRecordError extends Error {}

/**
 * Archiving Customers and Sites (out of lists and pickers, history kept)
 * and recording that Installed Equipment was removed or replaced.
 */
export default class Archiving {
  static archiveCustomer(id: number) {
    return this.setArchived(Customer, 'customer_id', id, true)
  }

  static restoreCustomer(id: number) {
    return this.setArchived(Customer, 'customer_id', id, false)
  }

  static archiveSite(id: number) {
    return this.setArchived(Site, 'site_id', id, true)
  }

  static restoreSite(id: number) {
    return this.setArchived(Site, 'site_id', id, false)
  }

  /**
   * Archiving is refused while the record has Jobs that aren't cancelled
   * (until finished Jobs can be told apart: Closed comes with Payments).
   */
  private static setArchived(
    model: typeof Customer | typeof Site,
    jobColumn: 'customer_id' | 'site_id',
    id: number,
    archived: boolean
  ) {
    return db.transaction(async (trx) => {
      const record = await model.query({ client: trx }).where('id', id).forUpdate().firstOrFail()
      if (archived) {
        const open = await trx
          .from('jobs')
          .where(jobColumn, id)
          .whereNot('status', 'cancelled')
          .first()
        if (open) throw new HasOpenJobsError()
      }
      record.archivedAt = archived ? (record.archivedAt ?? DateTime.now()) : null
      await record.useTransaction(trx).save()
      return record
    })
  }

  /**
   * Inside the caller's transaction, share-locks the Customer (and Site)
   * a new Job is for and refuses archived ones. Archiving takes an update
   * lock, so either it sees the Job or the Job sees the archiving.
   */
  static async lockActive(
    trx: TransactionClientContract,
    ids: { customerId: number; siteId?: number | null }
  ) {
    const customer = await Customer.query({ client: trx })
      .where('id', ids.customerId)
      .forShare()
      .firstOrFail()
    const site = ids.siteId
      ? await Site.query({ client: trx }).where('id', ids.siteId).forShare().firstOrFail()
      : null
    if (customer.archivedAt || site?.archivedAt) throw new ArchivedRecordError()
  }

  /**
   * Marks equipment as removed on a date, optionally replaced by other
   * current equipment at the same Site. Both rows are locked in id order,
   * so two removals pointing at each other can't both pass.
   */
  static async removeEquipment(
    equipment: InstalledEquipment,
    input: { removedOn: DateTime; replacedById?: number | null }
  ) {
    await db.transaction(async (trx) => {
      const ids = [equipment.id, input.replacedById ?? null]
        .filter((id): id is number => id !== null)
        .sort((a, b) => a - b)
      const rows = await InstalledEquipment.query({ client: trx })
        .whereIn('id', ids)
        .orderBy('id')
        .forUpdate()
      const locked = rows.find((row) => row.id === equipment.id)!
      if (locked.removedOn) throw new InvalidRemovalError()
      if (locked.installedOn && input.removedOn < locked.installedOn) {
        throw new InvalidRemovalError()
      }
      if (input.replacedById) {
        const replacement = rows.find((row) => row.id === input.replacedById)
        if (
          !replacement ||
          replacement.id === locked.id ||
          replacement.siteId !== locked.siteId ||
          replacement.removedOn
        ) {
          throw new InvalidRemovalError()
        }
      }
      locked.merge({ removedOn: input.removedOn, replacedById: input.replacedById ?? null })
      await locked.useTransaction(trx).save()
    })
  }
}
