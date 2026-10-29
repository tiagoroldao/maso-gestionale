import { readFile } from 'node:fs/promises'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import InstanceSettings from '#models/instance_settings'
import SupplierInvoice from '#models/supplier_invoice'
import SdiConnection from '#services/sdi_connection'
import type { SdiGateway } from '#services/sdi_gateway'
import { storagePath } from '#services/storage'
import { extractXmlBytes } from '#fiscal/fattura_pa_reader'

/**
 * How an archiving went: the intermediary took the file, or why not (a
 * code from `shared/sdi_failures.ts` or the intermediary's message).
 */
export type ArchivingResult = { outcome: 'requested' } | { outcome: 'failed'; failure: string }

/**
 * Why Office can't send an invoice to archiving now: the setting is off
 * or the intermediary can't archive (`notOffered`), or it isn't waiting
 * to go (`notWaiting`: requested already, or being sent).
 */
export class ArchivingRefusedError extends Error {
  constructor(readonly reason: 'notOffered' | 'notWaiting') {
    super(reason)
  }
}

/** How long a send may run before the poller takes it as cut off */
export const ARCHIVING_GRACE_MINUTES = 10

/** A file waiting to go to archiving */
export type PendingFile = { filePath: string; fileName: string }

/**
 * Legal archiving (conservazione a norma) of received Supplier Invoices
 * through the SDI intermediary (#214, ADR 0019), under the Instance
 * setting that covers sent Invoices too. Archiving is per file, so the
 * invoices of one file move together.
 *
 * With the setting on, every Supplier Invoice stored (received through
 * the intermediary or uploaded by Office) is queued and sent at once;
 * a failure never refuses the intake: the invoice stays, its archiving
 * failed, and the poller (or Office, from its page) retries. Invoices
 * stored before the setting was on are queued only by the Superuser's
 * one-off action.
 *
 * Sending happens outside any lock: the file's rows are claimed
 * (`sending`) under a lock, sent, and the result recorded under the lock
 * again. A send cut off before its answer (the process stopped) is
 * marked failed after a grace period and retried; the intermediary may
 * then get the file twice (see `docs/follow-ups.md`).
 */
export default class SupplierInvoiceArchiving {
  /**
   * The gateway to archive with: null when the setting is off or the
   * intermediary can't archive received invoices.
   */
  static async gateway(): Promise<SdiGateway | null> {
    const { sdiLegalArchiving } = await InstanceSettings.current()
    if (!sdiLegalArchiving) return null
    const gateway = await SdiConnection.gateway()
    return gateway.receivedArchiving ? gateway : null
  }

  /**
   * Sends a file's invoices, queued or failed, to archiving. Null when
   * there is nothing to send (already requested, or being sent). An SDI
   * identifier given is recorded on invoices without one first (Office's
   * uploads, #214). It never throws for the intermediary's failures:
   * they are recorded on the invoices and returned.
   */
  static async send(
    gateway: SdiGateway,
    filePath: string,
    options: { sdiIdentifier?: string | null } = {}
  ): Promise<ArchivingResult | null> {
    const claim = await db.transaction(async (trx) => {
      const rows = await SupplierInvoice.query({ client: trx })
        .where('filePath', filePath)
        .orderBy('id')
        .forUpdate()
      const waiting = rows.every(
        (row) => row.legalArchiving === 'queued' || row.legalArchiving === 'failed'
      )
      if (!rows.length || !waiting) return null

      const now = DateTime.now()
      const sdiId = rows[0].sdiIdentifier ?? options.sdiIdentifier ?? null
      for (const row of rows) {
        // SDI's identifier stands in for the metadata file the app doesn't keep
        row.merge(
          sdiId
            ? {
                sdiIdentifier: sdiId,
                legalArchiving: 'sending',
                legalArchivingAt: now,
                legalArchivingFailure: null,
              }
            : {
                legalArchiving: 'failed',
                legalArchivingAt: now,
                legalArchivingFailure: 'noSdiIdentifier',
              }
        )
        await row.save()
      }
      return sdiId ? { sdiId, fileName: rows[0].fileName, claimedAt: now } : 'noSdiIdentifier'
    })
    if (claim === null) return null
    if (claim === 'noSdiIdentifier') return { outcome: 'failed', failure: claim }

    let result: ArchivingResult
    let remoteIds: string[] = []
    try {
      const contents = await readFile(storagePath(filePath))
      const sent = await gateway.archiveReceived({
        fileName: claim.fileName,
        xml: extractXmlBytes(contents),
        sdiId: claim.sdiId,
      })
      remoteIds = sent.remoteIds
      result = { outcome: 'requested' }
    } catch (error) {
      logger.warn({ err: error }, `Legal archiving of ${claim.fileName} failed`)
      result = { outcome: 'failed', failure: failureOf(error) }
    }

    await db.transaction(async (trx) => {
      const rows = await SupplierInvoice.query({ client: trx })
        .where('filePath', filePath)
        .where('legalArchiving', 'sending')
        .forUpdate()
      const now = DateTime.now()
      for (const row of rows) {
        // Marked interrupted and claimed again meanwhile: that send records its own
        if (row.legalArchivingAt?.toMillis() !== claim.claimedAt.toMillis()) continue
        row.merge(
          result.outcome === 'requested'
            ? {
                legalArchiving: 'requested',
                legalArchivingAt: now,
                legalArchivingIds: remoteIds,
                legalArchivingFailure: null,
              }
            : {
                legalArchiving: 'failed',
                legalArchivingAt: now,
                legalArchivingFailure: result.failure,
              }
        )
        await row.save()
      }
    })
    return result
  }

  /**
   * Sends a file just stored by the intake: a failure, even of the
   * database, is logged and leaves the file for the poller, never
   * refusing the invoice already stored.
   */
  static async sendStored(gateway: SdiGateway, filePath: string) {
    try {
      await this.send(gateway, filePath)
    } catch (error) {
      logger.error({ err: error }, `Legal archiving of ${filePath} not sent`)
    }
  }

  /**
   * Office sends an invoice's file to archiving again (from its page),
   * with SDI's identifier when the invoice has none.
   */
  static async retry(invoice: SupplierInvoice, sdiIdentifier: string | null = null) {
    const gateway = await this.gateway()
    if (!gateway) throw new ArchivingRefusedError('notOffered')
    const result = await this.send(gateway, invoice.filePath, { sdiIdentifier })
    if (!result) throw new ArchivingRefusedError('notWaiting')
    return result
  }

  /**
   * The files the poller sends: queued, or failed with SDI's identifier
   * known (one without waits for Office to give it). Sends cut off past
   * the grace period are marked failed first, and retried.
   */
  static async pending(): Promise<PendingFile[]> {
    const cutoff = DateTime.now().minus({ minutes: ARCHIVING_GRACE_MINUTES })
    await db
      .from('supplier_invoices')
      .where('legal_archiving', 'sending')
      .where('legal_archiving_at', '<', cutoff.toJSDate())
      .update({
        legal_archiving: 'failed',
        legal_archiving_at: new Date(),
        legal_archiving_failure: 'archivingInterrupted',
      })
    const rows = await db
      .from('supplier_invoices')
      .where((query) =>
        query
          .where('legal_archiving', 'queued')
          .orWhere((failed) =>
            failed.where('legal_archiving', 'failed').whereNotNull('sdi_identifier')
          )
      )
      .groupBy('file_path')
      .select('file_path')
      .min('file_name as file_name')
      .orderByRaw('MIN(id)')
    return rows.map((row) => ({ filePath: row.file_path, fileName: row.file_name }))
  }

  /**
   * The Superuser's one-off action: queues every Supplier Invoice never
   * sent to archiving (stored before the setting was on) and asks for an
   * earlier poll, which sends them. How many it queued.
   */
  static async queueExisting(): Promise<number> {
    if (!(await this.gateway())) throw new ArchivingRefusedError('notOffered')
    const queued = await db
      .from('supplier_invoices')
      .whereNull('legal_archiving')
      .update({ legal_archiving: 'queued', legal_archiving_at: new Date() })
    await db.from('instance_settings').where('id', 1).update({ sdi_poll_requested_at: new Date() })
    return Number(queued)
  }

  /** Supplier Invoices never sent to archiving: what the one-off action would queue */
  static async neverQueued(): Promise<number> {
    const row = await db
      .from('supplier_invoices')
      .whereNull('legal_archiving')
      .count('* as total')
      .first()
    return Number(row?.total ?? 0)
  }
}

/**
 * Why a send failed: a code the app names, or the intermediary's message.
 */
function failureOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
