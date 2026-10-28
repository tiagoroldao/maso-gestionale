import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import Customer from '#models/customer'
import Invoice, { type CompanySnapshot, type CustomerSnapshot } from '#models/invoice'
import InvoiceSequence from '#models/invoice_sequence'
import InvoiceLine from '#models/invoice_line'
import Item from '#models/item'
import type User from '#models/user'
import VatCode from '#models/vat_code'
import StockLedger from '#stock/stock_ledger'
import { invoiceLineTotal } from '#shared/invoice_totals'

/**
 * The Invoice is no longer a draft, so it can't be changed or deleted.
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
 * The year's first Invoice is finalised, so its numbering is fixed.
 */
export class NumberingLockedError extends Error {}

export type InvoiceLineInput = {
  itemId?: number
  description: string
  quantity: string
  unitPrice: string
  discountPercent?: string
  vatCodeId: number
}

/**
 * Draft Invoices: creating, editing and deleting them. Every change locks
 * the Invoice and refuses anything but a draft.
 */
export default class Invoices {
  static create(customer: Customer) {
    return Invoice.create({ customerId: customer.id, status: 'draft' })
  }

  /**
   * Replaces the draft's lines, copying each VAT Code's rate and Natura
   * and each Item's unit onto the line.
   */
  static async save(
    invoice: Invoice,
    input: { discountPercent?: string; notes?: string | null; lines: InvoiceLineInput[] }
  ) {
    await this.whileDraft(invoice, async (trx, locked) => {
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
            unit: line.itemId ? (units.get(line.itemId) ?? null) : null,
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
    })
  }

  /**
   * Makes the draft a fiscal document: takes the year's next number and
   * today's date, works out the due date from the Customer's Payment
   * Terms, copies the Customer and company onto it, and takes Items sold
   * off stock. All in one transaction, with the year's sequence locked so
   * concurrent finalising can't skip or repeat a number.
   */
  static async finalise(invoice: Invoice, user: User | null = null) {
    return this.whileDraft(invoice, async (trx, locked) => {
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
        status: 'finalised',
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

      // Items sold without a Visit leave the Warehouse now; locked in id
      // order so two Invoices sharing Items can't deadlock
      const sold = lines.filter((line) => line.itemId)
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
              soleShareholder: company.soleShareholder as 'SU' | 'SM' | null,
              liquidationStatus: company.liquidationStatus as 'LN' | 'LS',
            }
          : null,
    }
  }

  static async destroy(invoice: Invoice) {
    await this.whileDraft(invoice, (_, locked) => locked.delete())
  }

  private static whileDraft<T>(
    invoice: Invoice,
    work: (trx: TransactionClientContract, locked: Invoice) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      const locked = await Invoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      if (locked.status !== 'draft') throw new InvoiceNotEditableError()
      return work(trx, locked)
    })
  }
}
