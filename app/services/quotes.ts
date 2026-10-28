import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Big from 'big.js'
import Charge from '#models/charge'
import CompanySettings from '#models/company_settings'
import Customer from '#models/customer'
import ChargeEvent from '#models/charge_event'
import Item from '#models/item'
import Job from '#models/job'
import Quote from '#models/quote'
import QuoteLine, { type QuoteLineKind } from '#models/quote_line'
import User from '#models/user'
import VatCode from '#models/vat_code'
import Visit from '#models/visit'
import { companyDetailsFrom } from '#documents/document_renderer'
import { lineTotal } from '#shared/money'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'
import { CHARGE_DESCRIPTION_MAX } from '#shared/charges'

export class QuoteNotEditableError extends Error {}

/**
 * Quote lines can't be imported: the Quote isn't accepted, the Job was
 * cancelled, the Visit is closed or not of the Job, no line to import was
 * chosen, or imported hours have no worker (a Technician on the Visit, or
 * on the Job any active Technician, or a name).
 */
export class QuoteImportRefusedError extends Error {
  constructor(readonly reason: 'notAccepted' | 'cancelled' | 'done' | 'noLines' | 'worker') {
    super(reason)
  }
}

export type QuoteImportInput = {
  lineIds: number[]
  // Onto this open Visit of the Job; otherwise onto the Job itself
  visitId?: number | null
  // Who worked the imported hours: an app user or someone outside the app
  technicianId?: number | null
  workerName?: string | null
}

export type QuoteLineInput = {
  kind: QuoteLineKind
  itemId?: number
  labourRateId?: number
  description: string
  quantity?: string
  unitPrice?: string
  vatCodeId?: number
}

export type QuoteInput = {
  notes?: string | null
  validityDays?: number | null
  lines: QuoteLineInput[]
}

/**
 * The rules around a Job's Quotes (ADR 0013): when one can be written,
 * edited, sent and decided. Each Quote has its own life; none of it moves
 * the Job, whose status follows its work (Scheduling).
 */
export default class Quotes {
  /**
   * Whether the Job can have a new Quote: at any time, before any work or
   * for extra work, while it isn't cancelled.
   */
  static canWrite(job: Job) {
    return job.status !== 'cancelled'
  }

  /**
   * Whether the Quote can still be written: a draft on a Job not
   * cancelled. Once sent it is frozen: a change means a new Quote.
   */
  static isEditable(job: Job, quote: Quote) {
    return this.canWrite(job) && quote.status === 'draft'
  }

  /**
   * Whether the Quote can be marked as sent: an editable draft with a
   * priced line (lines preloaded).
   */
  static isSendable(job: Job, quote: Quote) {
    return this.isEditable(job, quote) && quote.isPriced
  }

  /**
   * Whether the Customer's answer can be recorded: a sent Quote, or a
   * draft with a priced line, decided on the spot (which sends it), on a
   * Job not cancelled (lines preloaded).
   */
  static isDecidable(job: Job, quote: Quote) {
    return (
      this.canWrite(job) &&
      (quote.status === 'sent' || (quote.status === 'draft' && quote.isPriced))
    )
  }

  /**
   * Starts a new draft Quote on the Job, numbered after its last one under
   * the Job's lock, so concurrent ones never share a number.
   */
  static async create(job: Job, input: QuoteInput) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      if (!this.canWrite(locked)) throw new QuoteNotEditableError()
      const last = await trx
        .from('quotes')
        .where('job_id', locked.id)
        .max('sequence as max')
        .first()
      const quote = await Quote.create(
        { jobId: locked.id, sequence: Number(last?.max ?? 0) + 1, status: 'draft' },
        { client: trx }
      )
      await this.write(trx, quote, input)
      return quote
    })
  }

  /**
   * Replaces a draft's notes, validity and lines.
   */
  static async save(quote: Quote, input: QuoteInput) {
    return db.transaction(async (trx) => {
      const { job, locked } = await this.lock(trx, quote)
      if (!this.isEditable(job, locked)) throw new QuoteNotEditableError()
      await this.write(trx, locked, input)
      return locked
    })
  }

  /**
   * Writes the Quote's notes, validity and lines, dating it: a draft is
   * dated by its last save; sending and deciding leave the date alone.
   */
  private static async write(trx: TransactionClientContract, quote: Quote, input: QuoteInput) {
    quote.useTransaction(trx)
    quote.notes = input.notes ?? null
    quote.validityDays = input.validityDays ?? null
    quote.issuedOn = DateTime.now().startOf('day')
    await quote.save()

    const units = await this.itemUnits(input.lines, trx)
    const codeIds = input.lines.flatMap((line) => (line.vatCodeId ? [line.vatCodeId] : []))
    const codes = codeIds.length ? await VatCode.query({ client: trx }).whereIn('id', codeIds) : []
    const vat = new Map(codes.map((code) => [code.id, code]))
    await QuoteLine.query({ client: trx }).where('quoteId', quote.id).delete()
    await QuoteLine.createMany(
      input.lines.map((line, index) => this.toRow(quote.id, index, line, units, vat)),
      { client: trx }
    )
  }

  /**
   * Marks the draft as sent to the Customer: from now on it is frozen,
   * dated as last saved.
   */
  static async send(quote: Quote) {
    await db.transaction(async (trx) => {
      const { job, locked } = await this.lock(trx, quote)
      if (!this.isSendable(job, locked)) throw new QuoteNotEditableError()
      locked.status = 'sent'
      await this.copyAsSent(trx, job, locked, DateTime.now())
      await locked.save()
    })
  }

  static async accept(quote: Quote) {
    await this.decide(quote, 'accepted')
  }

  /**
   * Declines only this Quote: the Job and its other Quotes carry on, and
   * Office cancels the Job separately when nothing else goes ahead.
   */
  static async decline(quote: Quote) {
    await this.decide(quote, 'declined')
  }

  private static async decide(quote: Quote, status: 'accepted' | 'declined') {
    await db.transaction(async (trx) => {
      const { job, locked } = await this.lock(trx, quote)
      if (!this.isDecidable(job, locked)) throw new QuoteNotEditableError()
      locked.status = status
      locked.decidedAt = DateTime.now()
      // A draft decided on the spot, either way, was sent there and then
      if (!locked.sentAt) await this.copyAsSent(trx, job, locked, locked.decidedAt)
      await locked.save()
    })
  }

  /**
   * Dates the Quote as sent and copies what the Customer received: their
   * details, the company's and the subject (the Job's title, which the
   * Quote's number refers to), so the PDF stays as it went out. The logo
   * stays live, as on Invoices.
   */
  private static async copyAsSent(
    trx: TransactionClientContract,
    job: Job,
    quote: Quote,
    at: DateTime
  ) {
    const customer = await Customer.findOrFail(job.customerId, { client: trx })
    const settings = await CompanySettings.current()
    quote.sentAt = at
    quote.subject = job.title
    quote.customerSnapshot = customer.toSnapshot()
    quote.companySnapshot = companyDetailsFrom(settings)
  }

  /**
   * Locks the Quote's Job, then the Quote (with its lines), re-read, so a
   * save, cancel or decision can't interleave. A Quote never changes Job.
   */
  private static async lock(trx: TransactionClientContract, quote: Quote) {
    const job = await Job.query({ client: trx }).where('id', quote.jobId).forUpdate().firstOrFail()
    const locked = await Quote.query({ client: trx })
      .where('id', quote.id)
      .forUpdate()
      .preload('lines')
      .firstOrFail()
    locked.useTransaction(trx)
    return { job, locked }
  }

  /**
   * Imports the chosen lines of an accepted Quote as Charges (ADR 0012;
   * any accepted Quote of the Job, ADR 0013), onto the Job or one of its
   * open Visits: an Item line becomes an Item used (taken off stock when
   * the Visit closes; on the Job itself it moves no stock), a labour line
   * hours at its Labour Rate for the worker given, the call-out a Job
   * Charge (always on the Job), and text lines are skipped. Each starts at
   * the line's quantity, price, description and VAT Code and records which
   * line it came from; a line imported twice gives two Charges. Locks the
   * Visit, then the Job, as field work does.
   */
  static async importLines(quote: Quote, input: QuoteImportInput, user: User) {
    return db.transaction(async (trx) => {
      const visit = input.visitId
        ? await Visit.query({ client: trx })
            .where('id', input.visitId)
            .where('jobId', quote.jobId)
            .forUpdate()
            .first()
        : null
      if (input.visitId && !visit) throw new QuoteImportRefusedError('done')
      if (visit && CLOSED_VISIT_STATUSES.includes(visit.status)) {
        throw new QuoteImportRefusedError('done')
      }
      const locked = await Job.query({ client: trx })
        .where('id', quote.jobId)
        .forShare()
        .firstOrFail()
      if (locked.status === 'cancelled') throw new QuoteImportRefusedError('cancelled')
      // Decisions lock the Job for update, so this status holds
      const current = await Quote.query({ client: trx }).where('id', quote.id).firstOrFail()
      if (current.status !== 'accepted') throw new QuoteImportRefusedError('notAccepted')

      // Text lines and lines of nothing have nothing to charge
      const chosen = await QuoteLine.query({ client: trx })
        .where('quoteId', current.id)
        .whereIn('id', input.lineIds)
        .orderBy('position')
      const lines = chosen.filter((line) => line.kind !== 'text' && new Big(line.quantity!).gt(0))
      if (!lines.length) throw new QuoteImportRefusedError('noLines')

      const worker = lines.some((line) => line.kind === 'labour')
        ? await this.importWorker(trx, visit, input)
        : null

      const charges: Charge[] = []
      for (const line of lines) {
        const common = {
          jobId: locked.id,
          quoteLineId: line.id,
          quantity: line.quantity!,
          billQuantity: line.quantity!,
          unitPrice: line.unitPrice!,
          description: line.description.slice(0, CHARGE_DESCRIPTION_MAX),
          // The VAT treatment the Customer accepted, billed as such
          vatCodeId: line.vatCodeId,
        }
        const values: Partial<Charge> =
          line.kind === 'item'
            ? { ...common, kind: 'item', visitId: visit?.id ?? null, itemId: line.itemId }
            : line.kind === 'labour'
              ? {
                  ...common,
                  kind: 'labour',
                  visitId: visit?.id ?? null,
                  labourRateId: line.labourRateId,
                  userId: worker!.userId,
                  workerName: worker!.workerName,
                }
              : // The call-out is a cost of the Job, never of one Visit
                { ...common, kind: 'other', visitId: null, unit: line.unit, vatKind: 'labour' }
        const charge = await Charge.create(values, { client: trx })
        await ChargeEvent.create(
          {
            chargeId: charge.id,
            kind: 'recorded',
            userId: user.id,
            // Which Quote line it came from, shown in its history
            changes: { before: {}, after: { quoteLine: String(line.position + 1) } },
          },
          { client: trx }
        )
        charges.push(charge)
      }
      return charges
    })
  }

  /**
   * Who worked imported hours: a Technician on the Visit (on the Job
   * itself, any active Technician), or someone outside the app by name.
   */
  private static async importWorker(
    trx: TransactionClientContract,
    visit: Visit | null,
    input: QuoteImportInput
  ) {
    if (input.technicianId) {
      const technician = await User.find(input.technicianId, { client: trx })
      const onVisit =
        !visit ||
        (await trx
          .from('visit_technicians')
          .where('visit_id', visit.id)
          .where('user_id', input.technicianId)
          .first())
      if (!technician || technician.role !== 'technician' || !technician.isActive || !onVisit) {
        throw new QuoteImportRefusedError('worker')
      }
      return { userId: technician.id, workerName: null }
    }
    const name = input.workerName?.trim()
    if (!name) throw new QuoteImportRefusedError('worker')
    return { userId: null, workerName: name.slice(0, 100) }
  }

  private static async itemUnits(lines: QuoteLineInput[], trx: TransactionClientContract) {
    const ids = lines.flatMap((line) => (line.kind === 'item' && line.itemId ? [line.itemId] : []))
    if (!ids.length) return new Map<number, string>()
    const items = await Item.query({ client: trx }).whereIn('id', ids)
    return new Map(items.map((item) => [item.id, item.unit]))
  }

  private static toRow(
    quoteId: number,
    position: number,
    line: QuoteLineInput,
    units: Map<number, string>,
    vat: Map<number, VatCode>
  ) {
    if (line.kind === 'text') {
      return { quoteId, position, kind: line.kind, description: line.description }
    }
    const quantity = line.quantity!
    const unitPrice = line.unitPrice!
    const code = vat.get(line.vatCodeId!)!
    return {
      quoteId,
      position,
      kind: line.kind,
      itemId: line.kind === 'item' ? line.itemId! : null,
      labourRateId: line.kind === 'labour' ? line.labourRateId! : null,
      description: line.description,
      quantity,
      unit:
        line.kind === 'item'
          ? (units.get(line.itemId!) ?? null)
          : line.kind === 'labour'
            ? 'h'
            : null,
      unitPrice,
      lineTotal: lineTotal(quantity, unitPrice),
      // Copied from the VAT Code when written (ADR 0008)
      vatCodeId: code.id,
      vatRate: code.rate,
      natura: code.natura,
      legalNote: code.legalNote,
    }
  }
}
