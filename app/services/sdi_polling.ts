import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import InstanceSettings from '#models/instance_settings'
import InvoiceSubmission from '#models/invoice_submission'
import SdiReceivedFile from '#models/sdi_received_file'
import SdiConnection from '#services/sdi_connection'
import SdiReceiving, { receivingCallback } from '#services/sdi_receiving'
import Submissions, {
  NoticeBeforeSubmissionError,
  SubmissionRefusedError,
} from '#services/submissions'
import type { PollFailure, PollStep } from '#shared/sdi_failures'
import { supplierInvoiceIntake } from '#services/supplier_invoice_intake'
import SupplierInvoiceArchiving from '#services/supplier_invoice_archiving'
import LegalStorage from '#services/legal_storage'
import type { SdiGateway } from '#services/sdi_gateway'

/** Received files are listed again from a day before the newest one, in case of late arrivals */
const RECEIVED_OVERLAP_DAYS = 1

export type PollReport =
  | { polled: false }
  | {
      polled: true
      settled: number
      outcomes: number
      received: number
      handed: number
      archived: number
      failures: PollFailure[]
    }

/**
 * Whether the poller should poll now: the interval has passed since the
 * last poll, or a webhook asked for an earlier one.
 */
export function isPollDue(settings: InstanceSettings, now = DateTime.now()) {
  const last = settings.sdiPolledAt
  if (!last) return true
  if (settings.sdiPollRequestedAt && settings.sdiPollRequestedAt > last) return true
  return now.diff(last, 'minutes').minutes >= settings.pollingMinutes
}

/**
 * Polling the intermediary, the source of truth (ADR 0019): it reads
 * whether the intermediary's account archives (#224), settles sends whose
 * result is unknown, records SDI's outcomes on Submissions, fetches
 * received Supplier Invoices for the intake, and sends to legal archiving
 * the uploaded Supplier Invoices waiting for it (#214). With no
 * connection it does nothing. Only the poller (`sdi:poll`) runs it; a
 * webhook only asks for an earlier poll.
 */
export default class SdiPolling {
  static async poll(): Promise<PollReport> {
    const gateway = await SdiConnection.gateway()
    if (!gateway.automatic) return { polled: false }

    const failures: PollFailure[] = []
    await this.register(gateway, failures)
    await this.readLegalStorage(gateway, failures)
    const settled = await this.settleSends(gateway, failures)
    const outcomes = await this.outcomes(gateway, failures)
    const received = await this.receive(gateway, failures)
    const handed = await this.handOver(gateway, failures)
    const archived = await this.archive(failures)

    // Only the status columns, so a save of the settings meanwhile stays
    await db.rawQuery('INSERT INTO instance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING')
    await db
      .from('instance_settings')
      .where('id', 1)
      .update({
        sdi_polled_at: new Date(),
        sdi_poll_failure: failures.length ? JSON.stringify(failures) : null,
      })
    return { polled: true, settled, outcomes, received, handed, archived, failures }
  }

  /**
   * The receiving callback this process last saw registered, so it is
   * checked on the first poll and again only when the settings change it
   */
  static registered: string | null = null

  /**
   * Keeps the receiving callback registered at the intermediary: saving
   * the settings registers it, and this catches a failed or missed save.
   */
  private static async register(gateway: SdiGateway, failures: PollFailure[]) {
    await attempt(failures, 'register', null, async () => {
      const callback = await receivingCallback(await InstanceSettings.current())
      const key = JSON.stringify([gateway.channel, callback])
      if (key === this.registered) return
      await SdiReceiving.ensure(gateway, callback)
      this.registered = key
    })
  }

  /**
   * Reads the intermediary's account setting for legal archiving, when
   * never read or read more than a day ago, before anything is received
   * or archived by it. A failed read keeps the last one.
   */
  private static async readLegalStorage(gateway: SdiGateway, failures: PollFailure[]) {
    if (!LegalStorage.isDue(await InstanceSettings.current())) return
    await attempt(failures, 'legalStorage', null, () => LegalStorage.refresh(gateway))
  }

  /**
   * Sends left "sending" past the grace period: found at the
   * intermediary, or never arrived and ready to send again.
   */
  private static async settleSends(gateway: SdiGateway, failures: PollFailure[]) {
    let settled = 0
    const pending = await attempt(failures, 'unsettled', null, () => Submissions.unsettled(gateway))
    for (const submission of pending ?? []) {
      const done = await attempt(failures, 'settle', submission.fileName, () =>
        Submissions.settle(gateway, submission)
      )
      if (done) settled++
    }
    return settled
  }

  /**
   * SDI's outcome for each Submission sent and still waiting.
   */
  private static async outcomes(gateway: SdiGateway, failures: PollFailure[]) {
    let recorded = 0
    const waiting = await attempt(failures, 'waiting', null, () =>
      InvoiceSubmission.query()
        .where('channel', gateway.channel)
        .whereNull('outcome')
        .whereNotNull('submittedAt')
        .whereNotNull('remoteId')
        .preload('invoice')
        .orderBy('submittedAt')
    )
    for (const submission of waiting ?? []) {
      const done = await attempt(failures, 'outcome', submission.fileName, async () => {
        const report = await gateway.outcome(submission.remoteId!)
        if (!report) return false
        await Submissions.recordOutcome(submission.invoice, report, null, submission.id)
        return true
      })
      if (done) recorded++
    }
    return recorded
  }

  /**
   * Fetches the Supplier Invoice files not fetched yet, each once.
   */
  private static async receive(gateway: SdiGateway, failures: PollFailure[]) {
    const newest = await SdiReceivedFile.query()
      .where('channel', gateway.channel)
      .orderBy('receivedAt', 'desc')
      .first()
    const since = newest?.receivedAt.minus({ days: RECEIVED_OVERLAP_DAYS }) ?? null
    const refs = await attempt(failures, 'received', null, () => gateway.received(since))
    if (!refs?.length) return 0

    const known = await SdiReceivedFile.query()
      .where('channel', gateway.channel)
      .whereIn(
        'remoteId',
        refs.map((ref) => ref.remoteId)
      )
      .select('remoteId')
    const seen = new Set(known.map((row) => row.remoteId))
    let fetched = 0
    for (const ref of refs.filter((candidate) => !seen.has(candidate.remoteId))) {
      const done = await attempt(failures, 'download', ref.remoteId, async () => {
        const file = await gateway.download(ref)
        // A file fetched twice at once (two pollers) is kept once
        await db.rawQuery(
          `INSERT INTO sdi_received_files
             (channel, remote_id, file_name, content, sdi_id, received_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, now())
           ON CONFLICT (channel, remote_id) DO NOTHING`,
          [
            gateway.channel,
            ref.remoteId,
            file.fileName.slice(0, 100),
            file.content,
            ref.sdiId,
            ref.receivedAt.toJSDate(),
          ]
        )
        return true
      })
      if (done) fetched++
    }
    return fetched
  }

  /**
   * Hands the files waiting to the Supplier Invoice intake (#198), the
   * same way in as Office's uploads; a file it refuses waits for the next
   * poll.
   */
  private static async handOver(gateway: SdiGateway, failures: PollFailure[]) {
    const intake = supplierInvoiceIntake.current
    if (!intake) return 0
    let handed = 0
    const waiting = await SdiReceivedFile.query()
      .where('channel', gateway.channel)
      .whereNull('handedAt')
      .orderBy('receivedAt')
    for (const file of waiting) {
      try {
        await intake.receive({ fileName: file.fileName, content: file.content, sdiId: file.sdiId })
        file.merge({ handedAt: DateTime.now(), failure: null })
        handed++
      } catch (error) {
        file.failure = detail(error)
        failures.push({ step: 'handOver', subject: file.fileName, detail: file.failure })
      }
      await file.save()
    }
    return handed
  }

  /**
   * Sends to legal archiving the uploaded Supplier Invoices waiting for it
   * (#214): queued (by the intake or the Superuser's one-off action) or
   * failed before. Only when the intermediary's account archives (#224).
   */
  private static async archive(failures: PollFailure[]) {
    const gateway = await attempt(failures, 'archive', null, () =>
      SupplierInvoiceArchiving.gateway()
    )
    if (!gateway) return 0
    const pending = await attempt(failures, 'archive', null, () =>
      SupplierInvoiceArchiving.pending()
    )
    let archived = 0
    for (const file of pending ?? []) {
      await attempt(failures, 'archive', file.fileName, async () => {
        const result = await SupplierInvoiceArchiving.send(gateway, file.filePath)
        if (result?.outcome === 'requested') archived++
        if (result?.outcome === 'failed') {
          failures.push({ step: 'archive', subject: file.fileName, detail: result.failure })
        }
      })
    }
    return archived
  }
}

/**
 * Runs one step of the poll; a failure is noted and the poll goes on.
 */
async function attempt<T>(
  failures: PollFailure[],
  step: PollStep,
  subject: string | null,
  work: () => Promise<T>
) {
  try {
    return await work()
  } catch (error) {
    logger.warn({ err: error }, `SDI poll: ${step} ${subject ?? ''}`)
    failures.push({ step, subject, detail: detail(error) })
    return null
  }
}

/**
 * Why a step failed: a code the pages translate, or the intermediary's
 * own message.
 */
function detail(error: unknown): string {
  if (error instanceof SubmissionRefusedError) return 'submissionRefused'
  if (error instanceof NoticeBeforeSubmissionError) return 'noticeBeforeSubmission'
  return error instanceof Error ? error.message : String(error)
}
