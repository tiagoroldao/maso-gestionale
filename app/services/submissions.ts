import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import LegalStorage from '#services/legal_storage'
import Invoice from '#models/invoice'
import InvoiceSubmission, { type SubmissionOutcome } from '#models/invoice_submission'
import type User from '#models/user'
import { buildFatturaPA, fatturaFileName, fatturaInputFor } from '#fiscal/fattura_pa'
import { canTransition, transition, type InvoiceEvent } from '#shared/invoice_lifecycle'
import { SdiSendRefusedError, type SdiFile, type SdiGateway } from '#services/sdi_gateway'
import SdiConnection, { manualGateway } from '#services/sdi_connection'
import type { SdiFailureCode } from '#shared/sdi_failures'

/**
 * The Invoice isn't in a state where this Submission step applies.
 */
export class SubmissionRefusedError extends Error {}

/**
 * The notice is dated before the Submission was sent.
 */
export class NoticeBeforeSubmissionError extends Error {}

/**
 * A send is under way, or its result is not known yet: the poller settles
 * it (ADR 0019).
 */
export class SubmissionSendingError extends Error {}

/**
 * The intermediary refused the file; nothing reached SDI and it can be
 * sent again.
 */
export class SubmissionSendRefusedError extends Error {}

/**
 * The send failed in a way that leaves it unknown whether the file went:
 * the Submission stays "sending" until the poller finds out.
 */
export class SubmissionSendUncertainError extends Error {}

/** How long an unanswered send waits before the poller looks for it */
export const SENDING_GRACE_MINUTES = 10

/**
 * SDI's notice of the outcome: its date (today if not given), SDI's
 * identifier for the file, and the error codes for a Rejection.
 */
export type SdiNotice = {
  outcome: SubmissionOutcome
  noticeOn?: DateTime | null
  sdiId?: string | null
  notes?: string | null
}

const OUTCOME_EVENTS: Record<SubmissionOutcome, InvoiceEvent> = {
  delivered: 'deliver',
  not_deliverable: 'notDeliverable',
  rejected: 'reject',
}

/**
 * Sending finalised Invoices to SDI (ADR 0019). A Submission is prepared
 * (its progressive and file name reserved, so the XML can be downloaded),
 * confirmed once it went to SDI, and closed by SDI's outcome. Each one
 * has its own progressive, so a resubmission after a Rejection never
 * reuses a file name.
 *
 * Through an intermediary, confirming sends the file. The send happens
 * outside the Invoice lock: the Submission is marked "sending" under the
 * lock, the file goes, and the result is recorded under the lock again.
 * A send whose result is unknown (the process stopped, the connection
 * dropped) stays "sending" until the poller finds the file at the
 * intermediary or concludes it never arrived.
 *
 * When the intermediary's account archives (conservazione a norma, #224),
 * the file is sent with archiving requested, as the account requires, and
 * the Submission records it.
 */
export default class Submissions {
  /**
   * The Submission in progress for a finalised or rejected Invoice,
   * prepared now if there is none yet.
   */
  static async prepare(invoice: Invoice, user: User | null = null) {
    const gateway = await SdiConnection.gateway()
    return this.locked(invoice, async (trx, locked) => {
      const open = await this.open(trx, locked.id)
      if (open) return open
      if (!canTransition(locked.status, 'submit')) throw new SubmissionRefusedError()
      // A corrected Invoice may have lost its lines: nothing to send
      const line = await trx.from('invoice_lines').where('invoice_id', locked.id).first()
      if (!line) throw new SubmissionRefusedError()

      const settings = await CompanySettings.current()
      const progressive = await this.nextProgressive(trx, settings.sdiFilePrefix ?? 'M')
      const company = locked.companySnapshot!
      return InvoiceSubmission.create(
        {
          invoiceId: locked.id,
          channel: gateway.channel,
          progressive,
          fileName: fatturaFileName(company.taxCode ?? company.vatNumber, progressive),
          preparedAt: DateTime.now(),
          preparedBy: user?.id ?? null,
        },
        { client: trx }
      )
    })
  }

  /**
   * The XML of the prepared Submission, with its progressive.
   */
  static async xml(invoice: Invoice, submission: InvoiceSubmission, discountLabel: string) {
    await invoice.load('lines', (lines) => lines.orderBy('position'))
    // A Credit Note refers to the Invoice it credits
    if (invoice.isCreditNote) await invoice.load('creditedInvoice')
    return buildFatturaPA(fatturaInputFor(invoice, submission.progressive, discountLabel))
  }

  /**
   * The prepared Submission goes to SDI: Office uploaded it by hand, or
   * the intermediary sends it now. A Submission prepared by hand stays by
   * hand, since Office may already have uploaded its file.
   */
  static async confirm(
    invoice: Invoice,
    discountLabel: string,
    user: User | null = null
  ): Promise<'sent' | 'uploaded'> {
    const current = await SdiConnection.gateway()
    // The intermediary's account setting picks how it is sent (#224)
    const archives = await LegalStorage.active(current)
    const sending = await this.locked(invoice, async (trx, locked) => {
      const open = await this.open(trx, locked.id)
      // Already confirmed (a double click): nothing more to do
      if (open?.submittedAt) return null
      if (!open || !canTransition(locked.status, 'submit')) throw new SubmissionRefusedError()
      if (open.sendingAt) throw new SubmissionSendingError()
      const gateway = open.channel === manualGateway.channel ? manualGateway : current
      const xml = await this.xml(locked, open, discountLabel)

      if (!gateway.automatic) {
        // Kept as sent: legal archiving is up to the business (ADR 0019)
        open.merge({
          channel: gateway.channel,
          xml,
          submittedAt: DateTime.now(),
          submittedBy: user?.id ?? null,
          sendFailure: null,
        })
        await open.save()
        locked.status = transition(locked.status, 'submit')
        await locked.save()
        return null
      }

      const legalArchiving = archives
      open.merge({
        channel: gateway.channel,
        xml,
        sendingAt: DateTime.now(),
        submittedBy: user?.id ?? null,
        sendFailure: null,
        legalArchiving,
      })
      await open.save()
      return {
        gateway,
        submissionId: open.id,
        file: { fileName: open.fileName, xml },
        legalArchiving,
      }
    })
    if (!sending) return 'uploaded'
    await this.send(invoice, sending)
    return 'sent'
  }

  /**
   * Sends the file, outside the Invoice lock, and records the result.
   */
  private static async send(
    invoice: Invoice,
    {
      gateway,
      submissionId,
      file,
      legalArchiving,
    }: { gateway: SdiGateway; submissionId: number; file: SdiFile; legalArchiving: boolean }
  ) {
    let remoteId: string | null
    try {
      const sent = await gateway.submit(file, { legalArchiving })
      remoteId = sent.remoteId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof SdiSendRefusedError) {
        await this.unsent(invoice, submissionId, message)
        // Perhaps refused for the account setting, changed since it was
        // read: read it again, so the next send follows it
        await LegalStorage.refresh(gateway).catch(() => {})
        throw new SubmissionSendRefusedError(message)
      }
      await this.whileSending(invoice, submissionId, async (submission) => {
        submission.sendFailure = message
        await submission.save()
      })
      throw new SubmissionSendUncertainError(message)
    }
    await this.sent(invoice, submissionId, remoteId)
  }

  /**
   * The intermediary has the file: the Invoice is submitted, as of the
   * moment the send began.
   */
  static async sent(invoice: Invoice, submissionId: number, remoteId: string | null) {
    await this.whileSending(invoice, submissionId, async (submission, locked) => {
      submission.merge({ remoteId, submittedAt: submission.sendingAt, sendFailure: null })
      await submission.save()
      locked.status = transition(locked.status, 'submit')
      await locked.save()
    })
  }

  /**
   * The file never reached the intermediary: the Submission is ready to
   * be sent again.
   */
  static async unsent(invoice: Invoice, submissionId: number, failure: string) {
    await this.whileSending(invoice, submissionId, async (submission) => {
      submission.merge({
        sendingAt: null,
        xml: null,
        submittedBy: null,
        sendFailure: failure,
        legalArchiving: false,
      })
      await submission.save()
    })
  }

  /**
   * Submissions sent through `gateway` whose result is still unknown after
   * the grace period, with their Invoices.
   */
  static async unsettled(gateway: SdiGateway) {
    return InvoiceSubmission.query()
      .where('channel', gateway.channel)
      .whereNull('outcome')
      .whereNull('submittedAt')
      .where('sendingAt', '<', DateTime.now().minus({ minutes: SENDING_GRACE_MINUTES }).toSQL()!)
      .preload('invoice')
      .orderBy('sendingAt')
  }

  /**
   * Settles a send whose result is unknown: the intermediary has a file
   * for the Invoice that no other Submission accounts for, or the file
   * never arrived.
   */
  static async settle(gateway: SdiGateway, submission: InvoiceSubmission) {
    const invoice = submission.invoice
    const found = await gateway.findSent({
      number: invoice.formattedNumber!,
      issuedOn: invoice.issuedOn!.toISODate()!,
    })
    const known = await InvoiceSubmission.query()
      .where('channel', gateway.channel)
      .whereIn('remoteId', found.length ? found : [''])
      .select('remoteId')
    const taken = new Set(known.map((row) => row.remoteId))
    const remoteId = found.find((id) => !taken.has(id))
    if (remoteId) await this.sent(invoice, submission.id, remoteId)
    else
      await this.unsent(invoice, submission.id, 'notFoundAtIntermediary' satisfies SdiFailureCode)
    return remoteId ? 'sent' : 'unsent'
  }

  /**
   * Runs `work` on a Submission still "sending", under the Invoice lock;
   * a Submission settled meanwhile is left alone.
   */
  private static whileSending(
    invoice: Invoice,
    submissionId: number,
    work: (submission: InvoiceSubmission, locked: Invoice) => Promise<void>
  ) {
    return this.locked(invoice, async (trx, locked) => {
      const submission = await InvoiceSubmission.query({ client: trx })
        .where('id', submissionId)
        .where('invoiceId', locked.id)
        .forUpdate()
        .first()
      if (!submission?.sendingAt || submission.submittedAt || submission.outcome) return
      await work(submission, locked)
    })
  }

  /**
   * SDI's answer to the Submission in progress, dated by its notice (the
   * resubmission deadline counts from it).
   */
  static async recordOutcome(
    invoice: Invoice,
    notice: SdiNotice,
    user: User | null = null,
    submissionId: number | null = null
  ) {
    await this.locked(invoice, async (trx, locked) => {
      const open = await this.open(trx, locked.id)
      // A polled outcome belongs to that Submission only
      if (submissionId !== null && open?.id !== submissionId) throw new SubmissionRefusedError()
      const event = OUTCOME_EVENTS[notice.outcome]
      if (!open?.submittedAt || !canTransition(locked.status, event)) {
        throw new SubmissionRefusedError()
      }
      const noticeOn = notice.noticeOn ?? DateTime.now().startOf('day')
      // SDI can't answer a file before it was sent
      if (noticeOn < open.submittedAt.startOf('day')) throw new NoticeBeforeSubmissionError()
      open.merge({
        outcome: notice.outcome,
        noticeOn,
        sdiId: notice.sdiId ?? null,
        outcomeAt: DateTime.now(),
        outcomeBy: user?.id ?? null,
        outcomeNotes: notice.notes ?? null,
      })
      await open.save()
      locked.status = transition(locked.status, event)
      await locked.save()
    })
  }

  private static open(trx: TransactionClientContract, invoiceId: number) {
    return InvoiceSubmission.query({ client: trx })
      .where('invoiceId', invoiceId)
      .whereNull('outcome')
      .first()
  }

  /**
   * The prefix letter and the sequence in base 36: 1.6 million files.
   */
  private static async nextProgressive(trx: TransactionClientContract, prefix: string) {
    const result = await trx.rawQuery("SELECT nextval('sdi_progressive_seq') AS value")
    const value = Number(result.rows[0].value)
    return `${prefix}${value.toString(36).toUpperCase().padStart(4, '0')}`
  }

  private static locked<T>(
    invoice: Invoice,
    work: (trx: TransactionClientContract, locked: Invoice) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      const locked = await Invoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      // A Legacy Invoice is outside the SDI flow (#27)
      if (locked.isLegacy) throw new SubmissionRefusedError()
      locked.useTransaction(trx)
      return work(trx, locked)
    })
  }
}
