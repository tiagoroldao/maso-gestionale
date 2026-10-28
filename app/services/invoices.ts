import { DateTime } from 'luxon'
import Big from 'big.js'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import Customer from '#models/customer'
import Invoice, { type CompanySnapshot, type CustomerSnapshot } from '#models/invoice'
import InvoiceSequence from '#models/invoice_sequence'
import InvoiceLine from '#models/invoice_line'
import Item from '#models/item'
import Job from '#models/job'
import Quote from '#models/quote'
import Visit from '#models/visit'
import type User from '#models/user'
import VatCode from '#models/vat_code'
import StockLedger from '#stock/stock_ledger'
import type { LiquidationStatus, SoleShareholder } from '#shared/company'
import { invoiceLineTotal, invoiceTotals } from '#shared/invoice_totals'
import { workReadyToInvoice } from '#shared/visits'
import {
  canTransition,
  isDeletable,
  isEditable,
  transition,
  type InvoiceStatus,
} from '#shared/invoice_lifecycle'

/**
 * The Invoice's status doesn't allow the change: only drafts and rejected
 * Invoices are edited, only drafts deleted or finalised.
 */
export class InvoiceNotEditableError extends Error {}

/**
 * Serialises finalising across years, so the issue date and the year's
 * number come from one reading of the clock taken after the lock.
 */
const NUMBERING_LOCK_KEY = 4_190_419

/**
 * The draft can't be finalised yet: it has no lines, or the company
 * details an invoice must carry are missing from Company settings.
 */
export class InvoiceNotFinalisableError extends Error {
  constructor(readonly reason: 'empty' | 'companyIncomplete') {
    super(reason)
  }
}

/**
 * The Job has nothing to invoice yet (no accepted Quote; no recorded work,
 * or work on Visits still open), or it was cancelled.
 */
export class JobNotInvoiceableError extends Error {}

/**
 * The year's first Invoice is finalised, so its numbering is fixed.
 */
export class NumberingLockedError extends Error {}

export type InvoiceLineInput = {
  itemId?: number
  unit?: string
  description: string
  quantity: string
  unitPrice: string
  discountPercent?: string
  vatCodeId: number
}

/**
 * Invoices: drafting, correcting after a Rejection, finalising and
 * deleting. Every change locks the Invoice and checks its lifecycle.
 */
export default class Invoices {
  static create(customer: Customer) {
    return Invoice.create({ customerId: customer.id, status: 'draft' })
  }

  /**
   * A draft Invoice for a Job: from its accepted Quote, or from the time
   * and materials recorded on its Visits.
   */
  static fromJob(job: Job) {
    return job.kind === 'quoted' ? this.fromQuote(job) : this.fromTimeAndMaterials(job)
  }

  /**
   * A draft Invoice for a Time & Materials Job: one line per hours entry
   * and per Item recorded on its Visits, at the prices recorded with the
   * work (the policy noted on #22), so its total before VAT equals the Job
   * page's running total. Items take their own default VAT Code, labour
   * the standard rate, until the default rules (#26). Like a Quote, the
   * work is invoiced once: an existing Invoice is returned instead, until
   * billed lines are tracked (#75).
   */
  static async fromTimeAndMaterials(job: Job) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      if (locked.kind !== 'time_and_materials' || locked.status === 'cancelled') {
        throw new JobNotInvoiceableError()
      }
      const existing = await Invoice.query({ client: trx }).where('jobId', locked.id).first()
      if (existing) return existing

      const visits = await Visit.query({ client: trx })
        .where('jobId', locked.id)
        .preload('hours', (hours) =>
          hours.preload('labourRate').preload('technician').orderBy('createdAt')
        )
        .preload('items', (items) => items.preload('item').orderBy('createdAt'))
        .orderBy('startsAt')
      const work = visits.flatMap((visit) => [
        ...visit.hours.map((hour) => ({ visit, hour, line: null })),
        ...visit.items.map((line) => ({ visit, hour: null, line })),
      ])
      const ready = workReadyToInvoice(
        visits.map((visit) => ({
          status: visit.status,
          workLines: visit.hours.length + visit.items.length,
        }))
      )
      if (!ready) throw new JobNotInvoiceableError()

      const standard = await VatCode.query({ client: trx })
        .whereNull('archived_at')
        .whereNull('natura')
        .orderBy('rate', 'desc')
        .firstOrFail()
      const itemCodeIds = [
        ...new Set(work.flatMap(({ line }) => (line ? [line.item.vatCodeId] : []))),
      ]
      // An Item's archived code isn't offered: those lines get the standard rate
      const itemCodes = await VatCode.query({ client: trx })
        .whereIn('id', itemCodeIds)
        .whereNull('archived_at')
      const codes = new Map(itemCodes.map((code) => [code.id, code]))

      const invoice = await Invoice.create(
        { customerId: locked.customerId, jobId: locked.id, status: 'draft' },
        { client: trx }
      )
      await InvoiceLine.createMany(
        work.map(({ visit, hour, line }, position) => {
          const day = visit.startsAt.toFormat('dd/MM')
          const code = line ? (codes.get(line.item.vatCodeId) ?? standard) : standard
          const quantity = hour ? hour.hours : line!.quantity
          const unitPrice = hour ? hour.unitPrice : line!.unitPrice
          return {
            invoiceId: invoice.id,
            position,
            itemId: line?.itemId ?? null,
            description: hour
              ? `${hour.labourRate.name} – ${hour.technician.fullName ?? hour.technician.email} (${day})`
              : `${line!.item.description} (${day})`,
            quantity,
            unit: hour ? 'h' : line!.item.unit,
            unitPrice,
            discountPercent: '0',
            vatCodeId: code.id,
            vatRate: code.rate,
            natura: code.natura,
            legalNote: code.legalNote,
            lineTotal: invoiceLineTotal(quantity, unitPrice),
          }
        }),
        { client: trx }
      )
      return invoice
    })
  }

  /**
   * A draft Invoice for a Quoted Job, mirroring its accepted Quote: the
   * same prices and the VAT treatment the Customer accepted (copied from
   * the Quote's lines, not re-read from today's VAT Codes). Text lines and
   * the Quote's notes become the Invoice's notes. The Quote is invoiced
   * once: if the Job already has an Invoice, whatever its stage, that one
   * is returned instead of a second.
   */
  static async fromQuote(job: Job) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forUpdate().firstOrFail()
      const quote = await Quote.query({ client: trx })
        .where('jobId', locked.id)
        .preload('lines', (lines) => lines.orderBy('position'))
        .first()
      if (
        locked.kind !== 'quoted' ||
        quote?.status !== 'accepted' ||
        locked.status === 'cancelled'
      ) {
        throw new JobNotInvoiceableError()
      }
      const existing = await Invoice.query({ client: trx }).where('jobId', locked.id).first()
      if (existing) return existing

      const texts = quote.lines.filter((line) => line.kind === 'text')
      const notes = [quote.notes, ...texts.map((line) => line.description)]
        .filter(Boolean)
        .join('\n')
      const invoice = await Invoice.create(
        { customerId: locked.customerId, jobId: locked.id, status: 'draft', notes: notes || null },
        { client: trx }
      )
      const priced = quote.lines.filter((line) => line.kind !== 'text')
      await InvoiceLine.createMany(
        priced.map((line, position) => ({
          invoiceId: invoice.id,
          position,
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity!,
          unit: line.unit,
          unitPrice: line.unitPrice!,
          discountPercent: '0',
          vatCodeId: line.vatCodeId!,
          vatRate: line.vatRate!,
          natura: line.natura,
          legalNote: line.legalNote,
          lineTotal: invoiceLineTotal(line.quantity!, line.unitPrice!),
        })),
        { client: trx }
      )
      return invoice
    })
  }

  /**
   * Replaces the lines of a draft, or of a rejected Invoice being corrected
   * (which keeps its number and date), copying each VAT Code's rate and
   * Natura and each Item's unit onto the line. A rejected Invoice already
   * took its Items off stock, so the difference is booked in the stock.
   */
  static async save(
    invoice: Invoice,
    input: { discountPercent?: string; notes?: string | null; lines: InvoiceLineInput[] },
    user: User | null = null
  ) {
    await this.whileIn(isEditable, invoice, async (trx, locked) => {
      // A prepared Submission's file may already be on SDI: no changes under it
      const open = await trx
        .from('invoice_submissions')
        .where('invoice_id', locked.id)
        .whereNull('outcome')
        .first()
      if (open) throw new InvoiceNotEditableError()

      // Only Invoices without a Job move stock (see finalise)
      const soldBefore =
        locked.status === 'rejected' && !locked.jobId ? await this.itemsSold(trx, locked.id) : null
      if (locked.status === 'rejected') {
        // Rejections are often about the parties' data (a VAT number, the
        // recipient code): the correction takes the current Customer and
        // company, and keeps the number, dates and payment terms
        const issuer = this.companySnapshot(await CompanySettings.current())
        if (!issuer) throw new InvoiceNotFinalisableError('companyIncomplete')
        const customer = await Customer.findOrFail(locked.customerId, { client: trx })
        locked.merge({ customerSnapshot: this.customerSnapshot(customer), companySnapshot: issuer })
      }
      locked.merge({ discountPercent: input.discountPercent ?? '0', notes: input.notes ?? null })
      await locked.save()

      const codes = await VatCode.query({ client: trx }).whereIn(
        'id',
        input.lines.map((line) => line.vatCodeId)
      )
      const vat = new Map(codes.map((code) => [code.id, code]))
      const itemIds = input.lines.flatMap((line) => (line.itemId ? [line.itemId] : []))
      const items = itemIds.length ? await Item.query({ client: trx }).whereIn('id', itemIds) : []
      const units = new Map(items.map((item) => [item.id, item.unit]))

      await InvoiceLine.query({ client: trx }).where('invoiceId', locked.id).delete()
      await InvoiceLine.createMany(
        input.lines.map((line, position) => {
          const code = vat.get(line.vatCodeId)!
          const discountPercent = line.discountPercent ?? '0'
          return {
            invoiceId: locked.id,
            position,
            itemId: line.itemId ?? null,
            description: line.description,
            quantity: line.quantity,
            // An Item's own unit; otherwise what the line carried (e.g. "h")
            unit: line.itemId ? (units.get(line.itemId) ?? null) : (line.unit ?? null),
            unitPrice: line.unitPrice,
            discountPercent,
            vatCodeId: code.id,
            vatRate: code.rate,
            natura: code.natura,
            legalNote: code.legalNote,
            lineTotal: invoiceLineTotal(line.quantity, line.unitPrice, discountPercent),
          }
        }),
        { client: trx }
      )

      // A corrected Invoice's total changes with its lines
      if (locked.status !== 'draft') {
        const lines = await InvoiceLine.query({ client: trx }).where('invoiceId', locked.id)
        locked.total = this.totalOf(lines, locked.discountPercent)
        await locked.save()
      }

      if (soldBefore) {
        await this.rebookSale(trx, locked, soldBefore, await this.itemsSold(trx, locked.id), user)
      }
    })
  }

  /**
   * The grand total of a set of lines, as the Invoice shows it.
   */
  private static totalOf(lines: InvoiceLine[], discountPercent: string) {
    return invoiceTotals(
      lines.map((line) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        vatRate: line.vatRate,
        natura: line.natura,
      })),
      discountPercent
    ).total
  }

  /**
   * Quantity of each Item on the Invoice's lines.
   */
  private static async itemsSold(trx: TransactionClientContract, invoiceId: number) {
    const lines = await InvoiceLine.query({ client: trx })
      .where('invoiceId', invoiceId)
      .whereNotNull('itemId')
    const sold = new Map<number, Big>()
    for (const line of lines) {
      sold.set(line.itemId!, (sold.get(line.itemId!) ?? new Big(0)).plus(line.quantity))
    }
    return sold
  }

  /**
   * Books in the stock what a corrected (rejected) Invoice now sells
   * compared with before: more sold is a sale, less sold comes back as an
   * adjustment. The ledger is never rewritten.
   */
  private static async rebookSale(
    trx: TransactionClientContract,
    invoice: Invoice,
    before: Map<number, Big>,
    after: Map<number, Big>,
    user: User | null
  ) {
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)
    if (!ids.length) return
    const items = await Item.query({ client: trx }).whereIn('id', ids).orderBy('id').forUpdate()
    const today = DateTime.now().startOf('day')
    for (const item of items) {
      const change = (after.get(item.id) ?? new Big(0)).minus(before.get(item.id) ?? new Big(0))
      if (change.eq(0)) continue
      const common = { occurredOn: today, reference: invoice.formattedNumber, user, client: trx }
      if (change.gt(0)) {
        await StockLedger.sell(item, { ...common, quantity: change.toFixed() })
      } else {
        await StockLedger.adjust(item, {
          ...common,
          quantity: change.neg().toFixed(),
          reason: `Fattura ${invoice.formattedNumber} corretta dopo lo scarto`,
        })
      }
    }
  }

  /**
   * Makes the draft a fiscal document: takes the year's next number and
   * today's date, works out the due date from the Customer's Payment
   * Terms, copies the Customer and company onto it, and takes Items sold
   * off stock. All in one transaction, with the year's sequence locked so
   * concurrent finalising can't skip or repeat a number.
   */
  static async finalise(invoice: Invoice, user: User | null = null) {
    const finalisable = (status: InvoiceStatus) => canTransition(status, 'finalise')
    return this.whileIn(finalisable, invoice, async (trx, locked) => {
      const lines = await InvoiceLine.query({ client: trx })
        .where('invoiceId', locked.id)
        .orderBy('position')
      if (!lines.length) throw new InvoiceNotFinalisableError('empty')
      const issuer = this.companySnapshot(await CompanySettings.current())
      if (!issuer) throw new InvoiceNotFinalisableError('companyIncomplete')
      const customer = await Customer.query({ client: trx })
        .where('id', locked.customerId)
        .preload('paymentTerms')
        .firstOrFail()

      // Dated after the lock, so a later number never gets an earlier date
      // than one finalised while this one waited, and the year always
      // matches the date (even at midnight on 31 December)
      await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [NUMBERING_LOCK_KEY])
      const today = DateTime.now().startOf('day')
      locked.merge({
        status: transition(locked.status, 'finalise'),
        total: this.totalOf(lines, locked.discountPercent),
        year: today.year,
        number: await this.takeNumber(trx, today.year),
        issuedOn: today,
        dueOn: customer.paymentTerms.dueDate(today),
        paymentMethod: customer.paymentTerms.paymentMethod,
        customerSnapshot: this.customerSnapshot(customer),
        companySnapshot: issuer,
        finalisedAt: DateTime.now(),
      })
      await locked.save()

      // Items sold without a Job leave the Warehouse now (a Job's Items left
      // through its Visits); locked in id order so two Invoices sharing
      // Items can't deadlock
      const sold = locked.jobId ? [] : lines.filter((line) => line.itemId)
      const ids = [...new Set(sold.map((line) => line.itemId!))].sort((a, b) => a - b)
      const items = ids.length
        ? await Item.query({ client: trx }).whereIn('id', ids).orderBy('id').forUpdate()
        : []
      const byId = new Map(items.map((item) => [item.id, item]))
      for (const line of sold) {
        await StockLedger.sell(byId.get(line.itemId!)!, {
          quantity: line.quantity,
          occurredOn: today,
          reference: locked.formattedNumber,
          user,
          client: trx,
        })
      }
      return locked
    })
  }

  /**
   * Where the year's numbering stands: the next number, and whether it can
   * still be changed (no Invoice finalised that year yet).
   */
  static async numbering(year: number) {
    const sequence = await InvoiceSequence.findBy('year', year)
    const issued = await Invoice.query().where('year', year).first()
    return { year, nextNumber: sequence?.nextNumber ?? 1, locked: Boolean(issued) }
  }

  /**
   * Sets where the year's numbering starts, e.g. to continue from the old
   * accounting software. Refused once the year has a finalised Invoice.
   */
  static async setNextNumber(year: number, nextNumber: number) {
    await db.transaction(async (trx) => {
      const sequence = await this.lockedSequence(trx, year)
      const issued = await Invoice.query({ client: trx }).where('year', year).first()
      if (issued) throw new NumberingLockedError()
      sequence.nextNumber = nextNumber
      await sequence.save()
    })
  }

  private static async lockedSequence(trx: TransactionClientContract, year: number) {
    await trx
      .insertQuery()
      .table('invoice_sequences')
      .insert({ year, next_number: 1, created_at: new Date() })
      .onConflict('year')
      .ignore()
    const sequence = await InvoiceSequence.query({ client: trx })
      .where('year', year)
      .forUpdate()
      .firstOrFail()
    return sequence.useTransaction(trx)
  }

  private static async takeNumber(trx: TransactionClientContract, year: number) {
    const sequence = await this.lockedSequence(trx, year)
    const number = sequence.nextNumber
    sequence.nextNumber = number + 1
    await sequence.save()
    return number
  }

  private static customerSnapshot(customer: Customer): CustomerSnapshot {
    return {
      type: customer.type,
      name: customer.displayName,
      firstName: customer.firstName,
      lastName: customer.lastName,
      vatNumber: customer.vatNumber,
      taxCode: customer.taxCode,
      sdiCode: customer.sdiCode,
      pec: customer.pec,
      street: customer.street,
      streetNumber: customer.streetNumber,
      postalCode: customer.postalCode,
      city: customer.city,
      province: customer.province,
    }
  }

  /**
   * The issuer as an invoice needs it, or null while Company settings lack
   * what FatturaPA requires (name, Partita IVA, tax regime, address).
   */
  private static companySnapshot(company: CompanySettings): CompanySnapshot | null {
    const { name, vatNumber, taxRegime, street, postalCode, city, province } = company
    if (!name || !vatNumber || !taxRegime || !street || !postalCode || !city || !province) {
      return null
    }
    return {
      name,
      vatNumber,
      taxCode: company.taxCode,
      taxRegime,
      street,
      streetNumber: company.streetNumber,
      postalCode,
      city,
      province,
      email: company.email,
      phone: company.phone,
      iban: company.iban,
      rea:
        company.reaOffice && company.reaNumber
          ? {
              office: company.reaOffice,
              number: company.reaNumber,
              shareCapital: company.shareCapital,
              soleShareholder: company.soleShareholder as SoleShareholder | null,
              liquidationStatus: company.liquidationStatus as LiquidationStatus,
            }
          : null,
    }
  }

  static async destroy(invoice: Invoice) {
    await this.whileIn(isDeletable, invoice, (_, locked) => locked.delete())
  }

  /**
   * Runs `work` with the Invoice locked and re-read, refusing unless its
   * status passes `allowed`.
   */
  private static whileIn<T>(
    allowed: (status: InvoiceStatus) => boolean,
    invoice: Invoice,
    work: (trx: TransactionClientContract, locked: Invoice) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      const locked = await Invoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      if (!allowed(locked.status)) throw new InvoiceNotEditableError()
      return work(trx, locked)
    })
  }
}
