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
import Scheduling from '#services/scheduling'
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

/**
 * The rules around a Job's Quote: when it can be edited, sent and
 * decided, and how accepting or declining it moves the Job.
 */
export default class Quotes {
  /**
   * Whether the Job's Quote can still be written: any Job that is open or
   * quoted, whose Quote (if it has one yet) is still a draft. Once sent
   * it is frozen: a change means a new Quote (ADR 0013). A Quote is
   * started only on an open Job (ADR 0012).
   */
  static isEditable(job: Job, quote: Quote | null) {
    return (
      (job.status === 'open' || job.status === 'quoted') && (!quote || quote.status === 'draft')
    )
  }

  /**
   * Whether the Quote can be marked as sent: a draft with priced lines
   * (its Job is quoted).
   */
  static isSendable(job: Job, quote: Quote | null) {
    return quote?.status === 'draft' && job.status === 'quoted'
  }

  /**
   * Whether the Customer's answer can be recorded: a sent Quote, or a
   * draft with priced lines, decided on the spot (which sends it).
   */
  static isDecidable(job: Job, quote: Quote | null) {
    return (quote?.status === 'draft' || quote?.status === 'sent') && job.status === 'quoted'
  }

  /**
   * Replaces the Quote's lines (creating the Quote if needed) and marks the
   * Job as quoted once the Quote has a priced line.
   */
  static async save(
    job: Job,
    input: { notes?: string | null; validityDays?: number | null; lines: QuoteLineInput[] }
  ) {
    return db.transaction(async (trx) => {
      // Lock the Job first, so a cancel or another save can't interleave
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      job.merge({ status: locked.status })
      job.useTransaction(trx)
      const quote = await Quote.query({ client: trx }).where('jobId', job.id).forUpdate().first()
      if (!this.isEditable(job, quote)) throw new QuoteNotEditableError()

      const saved =
        quote ?? (await Quote.create({ jobId: job.id, status: 'draft' }, { client: trx }))
      saved.useTransaction(trx)
      saved.notes = input.notes ?? null
      saved.validityDays = input.validityDays ?? null
      // Dated by its last save while a draft; sending and deciding leave
      // the date alone
      saved.issuedOn = DateTime.now().startOf('day')
      await saved.save()

      const units = await this.itemUnits(input.lines, trx)
      const codeIds = input.lines.flatMap((line) => (line.vatCodeId ? [line.vatCodeId] : []))
      const codes = codeIds.length
        ? await VatCode.query({ client: trx }).whereIn('id', codeIds)
        : []
      const vat = new Map(codes.map((code) => [code.id, code]))
      await QuoteLine.query({ client: trx }).where('quoteId', saved.id).delete()
      await QuoteLine.createMany(
        input.lines.map((line, index) => this.toRow(saved.id, index, line, units, vat)),
        { client: trx }
      )

      const priced = input.lines.some((line) => line.kind !== 'text')
      job.status = priced ? 'quoted' : 'open'
      await job.save()
      return saved
    })
  }

  /**
   * Marks the draft as sent to the Customer: from now on it is frozen,
   * dated as last saved. The Job stays quoted.
   */
  static async send(job: Job) {
    await db.transaction(async (trx) => {
      const quote = await this.lockForDecision(trx, job)
      if (!quote || !this.isSendable(job, quote)) throw new QuoteNotEditableError()
      quote.useTransaction(trx)
      quote.status = 'sent'
      await this.copyAsSent(trx, job, quote, DateTime.now())
      await quote.save()
    })
  }

  static async accept(job: Job) {
    await this.decide(job, 'accepted', 'accepted')
  }

  static async decline(job: Job) {
    await this.decide(job, 'declined', 'cancelled')
  }

  private static async decide(
    job: Job,
    quoteStatus: 'accepted' | 'declined',
    jobStatus: 'accepted' | 'cancelled'
  ) {
    await db.transaction(async (trx) => {
      const quote = await this.lockForDecision(trx, job)
      if (!quote || !this.isDecidable(job, quote)) throw new QuoteNotEditableError()

      quote.useTransaction(trx)
      quote.status = quoteStatus
      quote.decidedAt = DateTime.now()
      // A draft decided on the spot was sent there and then
      if (!quote.sentAt) await this.copyAsSent(trx, job, quote, quote.decidedAt)
      await quote.save()

      job.status = jobStatus
      // Its Visits stay as history, closed to field work (FieldWork)
      if (jobStatus === 'cancelled') job.cancelledAt = DateTime.now()
      // Work booked while waiting for the signature starts the Job at once
      if (jobStatus === 'accepted') {
        // Upcoming or ongoing work only: past Visits and Surveys don't count
        if (await Scheduling.hasPendingWork(trx, job.id)) job.status = 'in_progress'
      }
      await job.save()
    })
  }

  /**
   * Dates the Quote as sent and copies what the Customer received: their
   * details, the company's and the subject (the Job's title), so the PDF
   * stays as it went out. The logo stays live, as on Invoices.
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
   * Locks the Job, then its Quote, and refreshes the Job's status, so a
   * save, cancel or other decision can't interleave.
   */
  private static async lockForDecision(trx: TransactionClientContract, job: Job) {
    const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
    job.merge({ status: locked.status, title: locked.title, customerId: locked.customerId })
    job.useTransaction(trx)
    return Quote.query({ client: trx }).where('jobId', job.id).forUpdate().first()
  }

  /**
   * Imports the chosen lines of the Job's accepted Quote as Charges (ADR
   * 0012), onto the Job or one of its open Visits: an Item line becomes an
   * Item used (taken off stock when the Visit closes; on the Job itself it
   * moves no stock), a labour line hours at its Labour Rate for the worker
   * given, the call-out a Job Charge (always on the Job), and text lines
   * are skipped. Each starts at the line's quantity, price, description
   * and VAT Code and records which line it came from; a line imported twice gives two
   * Charges. Locks the Visit, then the Job, as field work does.
   */
  static async importLines(job: Job, input: QuoteImportInput, user: User) {
    return db.transaction(async (trx) => {
      const visit = input.visitId
        ? await Visit.query({ client: trx })
            .where('id', input.visitId)
            .where('jobId', job.id)
            .forUpdate()
            .first()
        : null
      if (input.visitId && !visit) throw new QuoteImportRefusedError('done')
      if (visit && CLOSED_VISIT_STATUSES.includes(visit.status)) {
        throw new QuoteImportRefusedError('done')
      }
      const locked = await Job.query({ client: trx }).where('id', job.id).forShare().firstOrFail()
      if (locked.status === 'cancelled') throw new QuoteImportRefusedError('cancelled')
      const quote = await Quote.query({ client: trx }).where('jobId', locked.id).first()
      if (quote?.status !== 'accepted') throw new QuoteImportRefusedError('notAccepted')

      // Text lines and lines of nothing have nothing to charge
      const chosen = await QuoteLine.query({ client: trx })
        .where('quoteId', quote.id)
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
