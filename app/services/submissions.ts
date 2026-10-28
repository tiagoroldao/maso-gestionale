import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import Invoice from '#models/invoice'
import InvoiceSubmission, { type SubmissionOutcome } from '#models/invoice_submission'
import type User from '#models/user'
import { buildFatturaPA, fatturaFileName, fatturaInputFor } from '#fiscal/fattura_pa'
import { canTransition, transition, type InvoiceEvent } from '#shared/invoice_lifecycle'
import { ManualSdiGateway, type SdiGateway } from '#services/sdi_gateway'

/**
 * The Invoice isn't in a state where this Submission step applies.
 */
export class SubmissionRefusedError extends Error {}

const OUTCOME_EVENTS: Record<SubmissionOutcome, InvoiceEvent> = {
  delivered: 'deliver',
  not_deliverable: 'notDeliverable',
  rejected: 'reject',
}

/**
 * Sending finalised Invoices to SDI (ADR 0004). A Submission is prepared
 * (its progressive and file name reserved, so the XML can be downloaded),
 * confirmed once it went to SDI, and closed by SDI's outcome. Each one
 * has its own progressive, so a resubmission after a Rejection never
 * reuses a file name.
 */
export default class Submissions {
  /** Manual until an intermediary is configured; tests swap in a fake */
  static gateway: SdiGateway = new ManualSdiGateway()

  /**
   * The Submission in progress for a finalised or rejected Invoice,
   * prepared now if there is none yet.
   */
  static async prepare(invoice: Invoice, user: User | null = null) {
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
          channel: this.gateway.channel,
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
    return buildFatturaPA(fatturaInputFor(invoice, submission.progressive, discountLabel))
  }

  /**
   * The prepared Submission went to SDI (Office uploaded it, or the
   * gateway sends it now): the Invoice is submitted.
   */
  static async confirm(invoice: Invoice, discountLabel: string, user: User | null = null) {
    await this.locked(invoice, async (trx, locked) => {
      const open = await this.open(trx, locked.id)
      // Already confirmed (a double click): nothing more to do
      if (open?.submittedAt) return
      if (!open || !canTransition(locked.status, 'submit')) throw new SubmissionRefusedError()
      await this.gateway.submit({
        fileName: open.fileName,
        xml: await this.xml(locked, open, discountLabel),
      })
      open.merge({ submittedAt: DateTime.now(), submittedBy: user?.id ?? null })
      await open.save()
      locked.status = transition(locked.status, 'submit')
      await locked.save()
    })
  }

  /**
   * SDI's answer to the Submission in progress.
   */
  static async recordOutcome(
    invoice: Invoice,
    outcome: SubmissionOutcome,
    notes: string | null,
    user: User | null = null
  ) {
    await this.locked(invoice, async (trx, locked) => {
      const open = await this.open(trx, locked.id)
      const event = OUTCOME_EVENTS[outcome]
      if (!open?.submittedAt || !canTransition(locked.status, event)) {
        throw new SubmissionRefusedError()
      }
      open.merge({
        outcome,
        outcomeAt: DateTime.now(),
        outcomeBy: user?.id ?? null,
        outcomeNotes: notes,
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
      locked.useTransaction(trx)
      return work(trx, locked)
    })
  }
}
