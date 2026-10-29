import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import Customer from '#models/customer'
import Invoice from '#models/invoice'
import Job from '#models/job'
import LegacyVatRow from '#models/legacy_vat_row'
import Payment from '#models/payment'
import type User from '#models/user'
import VatCode from '#models/vat_code'
import { storagePath } from '#services/storage'
import { isUniqueViolation } from '#services/database_errors'
import {
  legacyAmountsRefusal,
  legacyRowVat,
  type LegacyAmountsRefusal,
} from '#shared/legacy_invoices'

/**
 * Why a Legacy Invoice can't be recorded, changed or deleted: its amounts
 * (legacyAmountsRefusal()); a Job of another Customer
 * (`customerNotOfJob`); a number another Legacy Invoice of that year has
 * (`duplicateNumber`); or, to change or delete it, Payments recorded on it
 * (`paid`), an Invoice taking it back, draft or issued (`takenBack`), or
 * a Credit Note, draft or not (`credited`); or a change in the meantime
 * that moved it to another Job (`changed`).
 */
export type LegacyRefusal =
  | LegacyAmountsRefusal
  | 'customerNotOfJob'
  | 'duplicateNumber'
  | 'paid'
  | 'takenBack'
  | 'credited'
  | 'changed'

export class LegacyInvoiceRefusedError extends Error {
  constructor(readonly reason: LegacyRefusal) {
    super(reason)
  }
}

/**
 * A Legacy Invoice as Office enters it from its PDF.
 */
export type LegacyInvoiceInput = {
  customerId: number
  jobId: number | null
  number: string
  issuedOn: DateTime
  // From the Customer's Payment Terms when left out
  dueOn: DateTime | null
  taxable: string
  vat: string
  total: string
  advance: boolean
  // An advance's VAT rows; ignored otherwise
  vatRows: { vatCodeId: number; taxable: string }[]
}

const DIRECTORY = 'invoices/legacy'

/**
 * Legacy Invoices (#27): invoices the previous accounting software issued,
 * entered by hand with their totals and original PDF. They stay outside
 * the SDI flow (Invoices and Submissions refuse them) but are otherwise
 * like any issued Invoice: Payments, payment status, a Job's indicators
 * and "invoiced so far", and, as an advance, taken back by the Job's later
 * Invoices (ADR 0011). One is changed or deleted only while nothing
 * depends on it: no Payment, and no Invoice taking it back.
 */
export default class LegacyInvoices {
  /**
   * Records a Legacy Invoice with its PDF. With `paidOn`, it was already
   * paid: one Payment for its total is recorded on that day.
   */
  static async create(
    input: LegacyInvoiceInput,
    pdf: MultipartFile,
    paidOn: DateTime | null,
    user: User | null = null
  ) {
    const rows = await this.vatRows(input)
    const stored = await this.store(pdf)
    try {
      return await db.transaction(async (trx) => {
        await this.lockJobs(trx, [input.jobId])
        const values = await this.values(trx, input, null)
        const invoice = await Invoice.create(
          {
            ...values,
            documentType: 'legacy',
            status: 'delivered',
            pdfPath: stored.path,
            pdfName: stored.name,
          },
          { client: trx }
        )
        await this.writeRows(trx, invoice, rows)
        if (paidOn) {
          await Payment.create(
            {
              invoiceId: invoice.id,
              amount: invoice.total!,
              paidOn,
              note: null,
              createdBy: user?.id ?? null,
            },
            { client: trx }
          )
        }
        return invoice
      })
    } catch (error) {
      // Don't leave a file that no row points to
      await unlink(storagePath(stored.path)).catch(() => {})
      throw this.refusalOf(error)
    }
  }

  /**
   * Changes a Legacy Invoice, and its PDF when a new one is given, while
   * nothing depends on it (see refuseInUse()). Its Jobs, before and after,
   * are locked first, as every Invoice change takes them.
   */
  static async update(invoice: Invoice, input: LegacyInvoiceInput, pdf: MultipartFile | null) {
    const rows = await this.vatRows(input)
    const stored = pdf ? await this.store(pdf) : null
    let replaced: string | null = null
    try {
      const updated = await db.transaction(async (trx) => {
        const current = await trx.from('invoices').where('id', invoice.id).select('job_id').first()
        const jobIds = [current?.job_id ?? null, input.jobId]
        await this.lockJobs(trx, jobIds)
        const locked = await this.lockLegacy(trx, invoice.id, jobIds)
        await this.refuseInUse(trx, locked.id)
        const values = await this.values(trx, input, locked.id)
        if (stored) {
          replaced = locked.pdfPath
          locked.merge({ pdfPath: stored.path, pdfName: stored.name })
        }
        await locked.merge(values).save()
        await LegacyVatRow.query({ client: trx }).where('invoiceId', locked.id).delete()
        await this.writeRows(trx, locked, rows)
        return locked
      })
      if (replaced) await unlink(storagePath(replaced)).catch(() => {})
      return updated
    } catch (error) {
      if (stored) await unlink(storagePath(stored.path)).catch(() => {})
      throw this.refusalOf(error)
    }
  }

  /**
   * Deletes a Legacy Invoice entered by mistake, with its PDF, while
   * nothing depends on it (see refuseInUse()).
   */
  static async destroy(invoice: Invoice) {
    const path = await db.transaction(async (trx) => {
      const current = await trx.from('invoices').where('id', invoice.id).select('job_id').first()
      await this.lockJobs(trx, [current?.job_id ?? null])
      const locked = await this.lockLegacy(trx, invoice.id, [current?.job_id ?? null])
      await this.refuseInUse(trx, locked.id)
      await locked.delete()
      return locked.pdfPath!
    })
    await unlink(storagePath(path)).catch(() => {})
  }

  /**
   * Refuses to change or delete a Legacy Invoice something depends on:
   * a Payment (recorded with the Invoice locked), or an Invoice taking it
   * back, a draft included, since its deduction lines were built from the
   * VAT rows (written with the Job locked), or a Credit Note (drafted
   * with the Invoice locked).
   */
  private static async refuseInUse(trx: TransactionClientContract, invoiceId: number) {
    const payment = await trx.from('payments').where('invoice_id', invoiceId).first()
    if (payment) throw new LegacyInvoiceRefusedError('paid')
    const deduction = await trx.from('advance_deductions').where('advance_id', invoiceId).first()
    const line = await trx.from('invoice_lines').where('deducts_invoice_id', invoiceId).first()
    if (deduction || line) throw new LegacyInvoiceRefusedError('takenBack')
    // Its Credit Notes, drafts included, credit what it says now
    const creditNote = await trx.from('invoices').where('credits_invoice_id', invoiceId).first()
    if (creditNote) throw new LegacyInvoiceRefusedError('credited')
  }

  /**
   * The VAT rows of an advance, each with its VAT Code's treatment copied
   * and its VAT worked out, after checking the amounts add up.
   */
  private static async vatRows(input: LegacyInvoiceInput) {
    const entries = input.advance ? input.vatRows : []
    const codes = entries.length
      ? await VatCode.query().whereIn(
          'id',
          entries.map((row) => row.vatCodeId)
        )
      : []
    const byId = new Map(codes.map((code) => [code.id, code]))
    const rows = entries.map((row) => {
      const code = byId.get(row.vatCodeId)!
      return {
        vatCodeId: code.id,
        vatRate: code.rate,
        natura: code.natura,
        legalNote: code.legalNote,
        taxable: row.taxable,
        vat: legacyRowVat({ vatRate: code.rate, taxable: row.taxable }),
      }
    })
    const refusal = legacyAmountsRefusal({ ...input, vatRows: rows })
    if (refusal) throw new LegacyInvoiceRefusedError(refusal)
    return rows
  }

  /**
   * The Invoice's own columns from the input, checked against the Job and
   * the other Legacy Invoices (all but `except`); the due date from the
   * Customer's Payment Terms when not given.
   */
  private static async values(
    trx: TransactionClientContract,
    input: LegacyInvoiceInput,
    except: number | null
  ) {
    if (input.jobId) {
      const job = await Job.findOrFail(input.jobId, { client: trx })
      if (job.customerId !== input.customerId) {
        throw new LegacyInvoiceRefusedError('customerNotOfJob')
      }
    }
    const duplicate = await trx
      .from('invoices')
      .where('document_type', 'legacy')
      .where('legacy_number', input.number)
      .whereRaw('extract(year FROM issued_on) = ?', [input.issuedOn.year])
      .whereNot('id', except ?? 0)
      .first()
    if (duplicate) throw new LegacyInvoiceRefusedError('duplicateNumber')
    const customer = await Customer.query({ client: trx })
      .where('id', input.customerId)
      .preload('paymentTerms')
      .firstOrFail()
    return {
      customerId: customer.id,
      jobId: input.jobId,
      advance: input.advance,
      legacyNumber: input.number,
      issuedOn: input.issuedOn,
      dueOn: input.dueOn ?? customer.paymentTerms.dueDate(input.issuedOn),
      taxable: input.taxable,
      vat: input.vat,
      total: input.total,
    }
  }

  private static async writeRows(
    trx: TransactionClientContract,
    invoice: Invoice,
    rows: Awaited<ReturnType<typeof LegacyInvoices.vatRows>>
  ) {
    if (!rows.length) return
    await LegacyVatRow.createMany(
      rows.map((row, position) => ({ ...row, invoiceId: invoice.id, position })),
      { client: trx }
    )
  }

  /**
   * Locks the Jobs given, in id order, so two changes can't deadlock.
   */
  private static async lockJobs(trx: TransactionClientContract, ids: (number | null)[]) {
    const jobIds = [...new Set(ids.filter((id): id is number => id !== null))].sort((a, b) => a - b)
    for (const id of jobIds) await trx.from('jobs').where('id', id).forUpdate().first()
  }

  /**
   * Locks the Legacy Invoice, after the Jobs `jobIds`. Refused when a
   * change in between moved it to another Job, which isn't locked
   * (`changed`).
   */
  private static async lockLegacy(
    trx: TransactionClientContract,
    invoiceId: number,
    jobIds: (number | null)[]
  ) {
    const locked = await Invoice.query({ client: trx })
      .where('id', invoiceId)
      .where('documentType', 'legacy')
      .forUpdate()
      .firstOrFail()
    if (locked.jobId && !jobIds.includes(locked.jobId)) {
      throw new LegacyInvoiceRefusedError('changed')
    }
    return locked.useTransaction(trx)
  }

  /**
   * Moves the uploaded PDF into the Instance's storage.
   */
  private static async store(pdf: MultipartFile) {
    const name = `${randomUUID()}.pdf`
    await pdf.move(storagePath(DIRECTORY), { name })
    return { path: `${DIRECTORY}/${name}`, name: pdf.clientName.slice(0, 255) }
  }

  /**
   * Two Legacy Invoices saved with the same number at once: the unique
   * index refuses the second (the only one a Legacy Invoice can break).
   */
  private static refusalOf(error: unknown) {
    return isUniqueViolation(error) ? new LegacyInvoiceRefusedError('duplicateNumber') : error
  }
}
