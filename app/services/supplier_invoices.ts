import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import Supplier from '#models/supplier'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoiceLine from '#models/supplier_invoice_line'
import type User from '#models/user'
import {
  extractXml,
  FatturaReadError,
  isSigned,
  readFatturaPA,
  type FatturaReadRefusal,
  type ReceivedFattura,
  type ReceivedSupplier,
} from '#fiscal/fattura_pa_reader'
import { isUniqueViolation } from '#services/database_errors'
import { storagePath } from '#services/storage'
import type { SupplierInvoiceDetails, SupplierInvoiceStatus } from '#shared/supplier_invoices'

/**
 * Why a received file is refused: it can't be read (FatturaReadRefusal),
 * it holds an invoice already received, by the supplier's VAT number,
 * number and date or by its SDI identifier (`duplicate`), or it isn't
 * addressed to the company (`notForCompany`), such as one of the
 * company's own issued invoices.
 */
export type SupplierInvoiceRefusal = FatturaReadRefusal | 'duplicate' | 'notForCompany'

export class SupplierInvoiceRefusedError extends Error {
  constructor(
    readonly reason: SupplierInvoiceRefusal,
    detail: string = reason
  ) {
    super(detail)
  }
}

/** A FatturaPA file as received: XML, or signed (.p7m) */
export type ReceivedFile = {
  contents: Buffer
  /** The file's name, kept to download it again */
  name: string
}

/**
 * How the file arrived: uploaded by Office, or delivered by the SDI
 * intermediary (#92) with SDI's identifier for it when the intermediary
 * gives one (null otherwise).
 */
export type Arrival = { via: 'upload'; user: User } | { via: 'sdi'; sdiIdentifier: string | null }

const DIRECTORY = 'supplier-invoices'

/**
 * Supplier Invoices (#198): every received FatturaPA file comes in through
 * receive(), whichever way it arrived, and lands in the inbox to handle.
 */
export default class SupplierInvoices {
  /**
   * Receives a Supplier Invoice file: reads it (FatturaPA 1.2.x, XML or
   * signed .p7m), finds or creates its Supplier by VAT number, refuses an
   * invoice already received, stores the original file and records each
   * invoice it holds (usually one) with its lines, to handle.
   *
   * This is the way in for both Office's upload and the SDI intermediary:
   * the gateway's receive path (#92) calls it with `{ via: 'sdi',
   * sdiIdentifier }` for each file it fetches, the identifier null when the
   * intermediary gives none. A file received before (by SDI identifier when
   * there is one, and always by the Supplier's number and date) is refused
   * with `duplicate`, so a poll that sees it again can treat that as
   * already done.
   */
  static async receive(file: ReceivedFile, arrival: Arrival): Promise<SupplierInvoice[]> {
    const fattura = this.read(file.contents)
    await this.refuseIfNotForCompany(fattura)
    this.refuseRepeatsWithin(fattura)

    const signed = isSigned(file.contents)
    const path = `${DIRECTORY}/${randomUUID()}.${signed ? 'xml.p7m' : 'xml'}`
    await mkdir(storagePath(DIRECTORY), { recursive: true })
    await writeFile(storagePath(path), file.contents)
    try {
      return await db.transaction(async (trx) => {
        const supplier = await this.lockSupplier(trx, fattura.supplier)
        await this.refuseDuplicates(trx, supplier, fattura, arrival)
        const created: SupplierInvoice[] = []
        for (const invoice of fattura.invoices) {
          const details: SupplierInvoiceDetails = {
            version: fattura.version,
            seller: {
              name: fattura.supplier.name,
              vatCountry: fattura.supplier.vatCountry,
              vatNumber: fattura.supplier.vatNumber,
              taxCode: fattura.supplier.taxCode,
              address: fattura.supplier.address,
            },
            buyer: fattura.buyer,
            summary: invoice.summary,
            payments: invoice.payments,
            notes: invoice.notes,
          }
          const record = await SupplierInvoice.create(
            {
              supplierId: supplier.id,
              documentType: invoice.documentType,
              currency: invoice.currency,
              number: invoice.number,
              issuedOn: DateTime.fromISO(invoice.issuedOn),
              taxable: invoice.taxable,
              vat: invoice.vat,
              total: invoice.total,
              status: 'to_handle',
              receivedVia: arrival.via,
              receivedBy: arrival.via === 'upload' ? arrival.user.id : null,
              sdiIdentifier: arrival.via === 'sdi' ? arrival.sdiIdentifier : null,
              filePath: path,
              fileName: fileNameOf(file.name, signed),
              details,
            },
            { client: trx }
          )
          await SupplierInvoiceLine.createMany(
            invoice.lines.map((line, position) => ({
              supplierInvoiceId: record.id,
              position,
              lineNumber: line.lineNumber,
              code: line.code?.slice(0, 35) ?? null,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit?.slice(0, 10) ?? null,
              unitPrice: line.unitPrice,
              total: line.total,
              vatRate: line.vatRate,
              natura: line.natura?.slice(0, 4) ?? null,
            })),
            { client: trx }
          )
          created.push(record)
        }
        return created
      })
    } catch (error) {
      // Don't leave a file that no row points to
      await unlink(storagePath(path)).catch(() => {})
      // Two arrivals of one invoice at once: the unique index refuses the second
      if (isUniqueViolation(error)) throw new SupplierInvoiceRefusedError('duplicate')
      throw error
    }
  }

  /**
   * Marks a Supplier Invoice handled, or sets it back to handle.
   */
  static async setStatus(invoice: SupplierInvoice, status: SupplierInvoiceStatus, user: User) {
    await db.transaction(async (trx) => {
      const locked = await SupplierInvoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      if (locked.status === status) return
      locked.merge(
        status === 'handled'
          ? { status, handledAt: DateTime.now(), handledBy: user.id }
          : { status, handledAt: null, handledBy: null }
      )
      await locked.save()
    })
  }

  private static read(contents: Buffer) {
    try {
      return readFatturaPA(extractXml(contents))
    } catch (error) {
      if (error instanceof FatturaReadError) {
        throw new SupplierInvoiceRefusedError(error.reason, error.message)
      }
      throw error
    }
  }

  /**
   * Refuses an invoice whose buyer isn't the company, by VAT number or
   * Codice Fiscale, once the company's are set.
   */
  private static async refuseIfNotForCompany(fattura: ReceivedFattura) {
    const company = await CompanySettings.current()
    const ours = [company.vatNumber, company.taxCode]
      .filter((id): id is string => Boolean(id))
      .map((id) => id.toUpperCase().replace(/^IT(?=\d{11}$)/, ''))
    if (!ours.length) return
    const buyer = [fattura.buyer.vatNumber, fattura.buyer.taxCode]
      .filter((id): id is string => Boolean(id))
      .map((id) => id.replace(/[^A-Z0-9]/g, '').replace(/^IT(?=\d{11}$)/, ''))
    if (!buyer.some((id) => ours.includes(id))) {
      throw new SupplierInvoiceRefusedError('notForCompany')
    }
  }

  /** One file listing the same invoice twice */
  private static refuseRepeatsWithin(fattura: ReceivedFattura) {
    const keys = fattura.invoices.map((invoice) => `${invoice.number}|${invoice.issuedOn}`)
    if (new Set(keys).size !== keys.length) throw new SupplierInvoiceRefusedError('duplicate')
  }

  /**
   * The invoice's Supplier, created the first time its VAT number is seen,
   * and locked: one file at a time per Supplier is checked and written.
   */
  private static async lockSupplier(trx: TransactionClientContract, received: ReceivedSupplier) {
    const now = new Date()
    const address = received.address
    // Another file of the same new Supplier may be arriving at once: insert or keep theirs
    await trx
      .knexQuery()
      .table('suppliers')
      .insert({
        name: received.name.slice(0, 255),
        vat_country: received.vatCountry,
        vat_number: received.vatNumber,
        tax_code: received.taxCode && received.taxCode.length <= 16 ? received.taxCode : null,
        street: address
          ? [address.street, address.streetNumber].filter(Boolean).join(' ').slice(0, 255) || null
          : null,
        postal_code: address?.postalCode.slice(0, 10) || null,
        city: address?.city.slice(0, 255) || null,
        province: address?.province?.slice(0, 2) ?? null,
        country: address?.country.slice(0, 2) ?? null,
        email: received.email?.slice(0, 255) ?? null,
        phone: received.phone?.slice(0, 50) ?? null,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['vat_country', 'vat_number'])
      .ignore()
    return Supplier.query({ client: trx })
      .where('vatCountry', received.vatCountry)
      .where('vatNumber', received.vatNumber)
      .forUpdate()
      .firstOrFail()
  }

  /**
   * With the Supplier locked: refuses a file already received (its SDI
   * identifier) or an invoice the Supplier already sent (number and date).
   */
  private static async refuseDuplicates(
    trx: TransactionClientContract,
    supplier: Supplier,
    fattura: ReceivedFattura,
    arrival: Arrival
  ) {
    if (arrival.via === 'sdi' && arrival.sdiIdentifier !== null) {
      const received = await trx
        .from('supplier_invoices')
        .where('sdi_identifier', arrival.sdiIdentifier)
        .first()
      if (received) throw new SupplierInvoiceRefusedError('duplicate')
    }
    for (const invoice of fattura.invoices) {
      const existing = await trx
        .from('supplier_invoices')
        .where('supplier_id', supplier.id)
        .where('number', invoice.number)
        .where('issued_on', invoice.issuedOn)
        .first()
      if (existing) throw new SupplierInvoiceRefusedError('duplicate')
    }
  }
}

/**
 * The name the file is downloaded as: the one it came with, or a plain
 * one with the right extension.
 */
function fileNameOf(name: string, signed: boolean) {
  const clean = basename(name.replaceAll('\\', '/')).trim().slice(0, 255)
  return clean || (signed ? 'fattura.xml.p7m' : 'fattura.xml')
}
