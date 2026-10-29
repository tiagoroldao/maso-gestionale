import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import InstanceSettings from '#models/instance_settings'
import { SdiFailure, type SdiGateway } from '#services/sdi_gateway'
import { intermediaryFiscalId } from '#services/sdi_receiving'
import type { LegalStorageStatus } from '#shared/instance'

/** How old the account setting as read may get before the poller reads it again */
export const LEGAL_STORAGE_REFRESH_HOURS = 24

/**
 * Legal archiving (conservazione a norma) at the SDI intermediary (#224,
 * ADR 0019). It is a setting of the intermediary's account, made outside
 * the app (Openapi's `apply_legal_storage`, set only when the account's
 * Business Registry Configuration is created): the app reads it and
 * follows it, and never switches it.
 *
 * The poller reads it into Instance settings (when never read, then once
 * a day), and so do saving Openapi mode and a refused send. With it on, the
 * intermediary takes sends only with archiving requested, archives what
 * it receives on receipt, and takes uploaded Supplier Invoices for
 * archiving; with it off, it refuses archiving.
 */
export default class LegalStorage {
  /**
   * Whether the intermediary archives, as last read: never without one,
   * nor while unread. Sending follows it: a file goes with archiving
   * requested exactly when it is on. If the account changed since (or it
   * was never read), the intermediary refuses the file, nothing is sent,
   * and Submissions reads it again for the next send.
   */
  static async active(gateway: SdiGateway): Promise<boolean> {
    if (!gateway.automatic) return false
    const { sdiLegalStorage } = await InstanceSettings.current()
    return sdiLegalStorage === true
  }

  /**
   * Reads the account setting from the intermediary and stores it.
   */
  static async refresh(gateway: SdiGateway): Promise<boolean> {
    const fiscalId = await intermediaryFiscalId()
    if (!fiscalId) throw new SdiFailure('noFiscalId')
    const archives = await gateway.readLegalStorage(fiscalId)
    // Only these columns, so a save of the settings meanwhile stays
    await db.rawQuery('INSERT INTO instance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING')
    await db
      .from('instance_settings')
      .where('id', 1)
      .update({ sdi_legal_storage: archives, sdi_legal_storage_read_at: new Date() })
    return archives
  }

  /**
   * Whether the poller should read it again: never read, or read more
   * than a day ago.
   */
  static isDue(settings: InstanceSettings, now = DateTime.now()) {
    const read = settings.sdiLegalStorageReadAt
    if (settings.sdiLegalStorage === null || !read) return true
    return now.diff(read, 'hours').hours >= LEGAL_STORAGE_REFRESH_HOURS
  }

  /**
   * What the Instance page shows: no intermediary (manual mode, or no
   * usable token), not read yet, or the account's setting.
   */
  static status(gateway: SdiGateway, settings: InstanceSettings): LegalStorageStatus {
    if (!gateway.automatic) return 'manual'
    if (settings.sdiLegalStorage === null) return 'unknown'
    return settings.sdiLegalStorage ? 'active' : 'inactive'
  }
}
