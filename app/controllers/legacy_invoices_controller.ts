import { existsSync } from 'node:fs'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Customer from '#models/customer'
import Invoice from '#models/invoice'
import Job from '#models/job'
import VatCode from '#models/vat_code'
import Invoices from '#services/invoices'
import LegacyInvoices, {
  LegacyInvoiceRefusedError,
  type LegacyInvoiceInput,
} from '#services/legacy_invoices'
import { storagePath } from '#services/storage'
import { legacyInvoiceActions } from '#services/legacy_invoice_actions'
import { advanceState } from '#shared/advances'
import { creditRefusal } from '#shared/credit_notes'
import { formatDate } from '#shared/dates'
import { overpaidBy, owed, paymentStatus } from '#shared/payment_status'
import { legacyInvoiceValidator, newLegacyInvoiceValidator } from '#validators/invoice'
import type { Infer } from '@vinejs/vine/types'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Legacy Invoices (#27): Office enters the invoices the previous software
 * issued, with their totals and original PDF, and corrects or deletes one
 * while nothing depends on it. Its Payments are recorded as on any
 * Invoice (InvoicesController).
 */
export default class LegacyInvoicesController {
  /**
   * The form for a new Legacy Invoice: for a Customer (`customerId`), or
   * for a Job (`jobId`), its Customer's.
   */
  async create({ request, inertia, response, session, i18n }: HttpContext) {
    const { customerId, jobId } = await newLegacyInvoiceValidator.validate(request.qs())
    const job = jobId ? await Job.find(jobId) : null
    const jobCustomer = job ? await Customer.find(job.customerId) : null
    // An archived Customer can't be picked: say so on the Job
    if (job && jobCustomer?.archivedAt) {
      session.flash('error', i18n.t('flash.legacyInvoiceCustomerArchived'))
      return response.redirect().withQs(false).toRoute('jobs.show', { id: job.id })
    }
    const customer = job
      ? jobCustomer
      : customerId
        ? await Customer.query().where('id', customerId).whereNull('archivedAt').first()
        : null

    return inertia.render('invoices/legacy', {
      // Registra, once the Customer is picked
      actions: legacyInvoiceActions(
        { invoice: null, customerPicked: customer !== null, editable: true, canCredit: false },
        i18n
      ),
      invoice: null,
      customer: customer ? { id: customer.id, displayName: customer.displayName } : null,
      jobId: job?.id ?? null,
      jobs: customer ? await jobsOf(customer.id) : [],
      vatCodes: await vatCodeOptions([]),
      editable: true,
      creditNotes: [],
      advanceState: null,
      payments: [],
      paymentSummary: null,
    })
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(legacyInvoiceValidator, {
      meta: { customerId: null, vatCodeIds: [], creating: true },
    })
    try {
      const paidOn = data.paid ? (data.paidOn ?? data.issuedOn) : null
      const invoice = await LegacyInvoices.create(
        inputOf(data),
        data.pdf!,
        paidOn,
        auth.getUserOrFail()
      )
      // A Payment dated before the invoice is recorded, with a warning
      // (ADR 0014)
      if (paidOn && paidOn < data.issuedOn) {
        session.flash(
          'warning',
          `${i18n.t('flash.legacyInvoiceCreated')} ${i18n.t('flash.paymentWarning.beforeIssued', {
            date: formatDate(data.issuedOn.toISODate()!),
          })}`
        )
        return response.redirect().toRoute('legacy_invoices.show', { id: invoice.id })
      }
      session.flash('success', i18n.t('flash.legacyInvoiceCreated'))
      return response.redirect().toRoute('legacy_invoices.show', { id: invoice.id })
    } catch (error) {
      if (!(error instanceof LegacyInvoiceRefusedError)) throw error
      session.flash('error', i18n.t(`flash.legacyInvoiceRefused.${error.reason}`))
      return response.redirect().back()
    }
  }

  async show({ params, inertia, i18n }: HttpContext) {
    const invoice = await Invoice.query()
      .where('id', params.id)
      .where('documentType', 'legacy')
      .preload('customer')
      .preload('job')
      .preload('legacyVatRows', (rows) => rows.orderBy('position'))
      .preload('payments', (payments) => payments.orderBy('paidOn'))
      .preload('creditNotes', (notes) => notes.orderBy('id'))
      .firstOrFail()
    // As an advance: how much the Job's issued Invoices took back (ADR 0011)
    const advances =
      invoice.advance && invoice.jobId ? await Invoices.advancesOf(undefined, invoice.jobId) : []
    const advance = advances.find((entry) => entry.advance.id === invoice.id)
    const takenBack = await db.from('invoice_lines').where('deducts_invoice_id', invoice.id).first()
    const deducted = await db.from('advance_deductions').where('advance_id', invoice.id).first()
    const amounts = { total: invoice.total!, credited: invoice.credited, paid: invoice.paid }
    // Changed or deleted only while nothing depends on it
    const editable =
      !invoice.payments.length && !takenBack && !deducted && !invoice.creditNotes.length
    // Credited by amounts (#27), from the header; an advance only for what is left of it
    const canCredit = creditRefusal(invoice) === null && (!advance || Number(advance.left) > 0)

    return inertia.render('invoices/legacy', {
      // The header's actions, for its state (Office and the Admin alike)
      actions: legacyInvoiceActions(
        { invoice: { id: invoice.id }, customerPicked: true, editable, canCredit },
        i18n
      ),
      invoice: {
        id: invoice.id,
        number: invoice.legacyNumber!,
        issuedOn: invoice.issuedOn!.toISODate()!,
        dueOn: invoice.dueOn!.toISODate()!,
        customer: { id: invoice.customer.id, displayName: invoice.customer.displayName },
        job: invoice.job
          ? { id: invoice.job.id, number: invoice.job.number, title: invoice.job.title }
          : null,
        taxable: invoice.taxable!,
        vat: invoice.vat!,
        total: invoice.total!,
        advance: invoice.advance,
        vatRows: invoice.legacyVatRows.map((row) => ({
          vatCodeId: row.vatCodeId,
          vatRate: row.vatRate,
          natura: row.natura,
          taxable: row.taxable,
          vat: row.vat,
        })),
        pdfName: invoice.pdfName!,
      },
      customer: { id: invoice.customer.id, displayName: invoice.customer.displayName },
      jobId: invoice.jobId,
      jobs: await jobsOf(invoice.customerId),
      vatCodes: await vatCodeOptions(invoice.legacyVatRows.map((row) => row.vatCodeId)),
      editable,
      creditNotes: invoice.creditNotes.map((note) => ({
        id: note.id,
        number: note.formattedNumber,
        status: note.status,
        total: note.total,
      })),
      advanceState: advance
        ? {
            state: advanceState(invoice.total!, advance.deducted, advance.credited),
            deducted: advance.deducted,
            left: advance.left,
          }
        : null,
      payments: invoice.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        paidOn: payment.paidOn.toISODate()!,
        note: payment.note,
      })),
      paymentSummary: {
        status: paymentStatus({
          ...amounts,
          dueOn: invoice.dueOn!.toISODate()!,
          today: DateTime.now().toISODate()!,
        }),
        credited: invoice.credited,
        paid: invoice.paid,
        owed: owed(amounts),
        overpaidBy: overpaidBy(amounts),
      },
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const invoice = await Invoice.query()
      .where('id', params.id)
      .where('documentType', 'legacy')
      .preload('legacyVatRows')
      .firstOrFail()
    const data = await request.validateUsing(legacyInvoiceValidator, {
      meta: {
        customerId: invoice.customerId,
        vatCodeIds: invoice.legacyVatRows.map((row) => row.vatCodeId),
        creating: false,
      },
    })
    try {
      await LegacyInvoices.update(invoice, inputOf(data), data.pdf ?? null)
      session.flash('success', i18n.t('flash.legacyInvoiceSaved'))
    } catch (error) {
      if (!(error instanceof LegacyInvoiceRefusedError)) throw error
      session.flash('error', i18n.t(`flash.legacyInvoiceRefused.${error.reason}`))
    }
    return response.redirect().toRoute('legacy_invoices.show', { id: invoice.id })
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const invoice = await Invoice.query()
      .where('id', params.id)
      .where('documentType', 'legacy')
      .firstOrFail()
    try {
      await LegacyInvoices.destroy(invoice)
    } catch (error) {
      if (!(error instanceof LegacyInvoiceRefusedError)) throw error
      session.flash('error', i18n.t(`flash.legacyInvoiceRefused.${error.reason}`))
      return response.redirect().toRoute('legacy_invoices.show', { id: invoice.id })
    }
    session.flash('success', i18n.t('flash.legacyInvoiceDeleted'))
    return response.redirect().toRoute('invoices.index')
  }

  /**
   * The original PDF, as uploaded.
   */
  async pdf({ params, response }: HttpContext) {
    const invoice = await Invoice.query()
      .where('id', params.id)
      .where('documentType', 'legacy')
      .firstOrFail()
    const path = storagePath(invoice.pdfPath!)
    if (!existsSync(path)) return response.notFound()
    response.header('x-content-type-options', 'nosniff')
    return response.attachment(path, invoice.pdfName!, 'inline')
  }
}

type LegacyInvoiceData = Infer<typeof legacyInvoiceValidator>

function inputOf(data: LegacyInvoiceData): LegacyInvoiceInput {
  return {
    customerId: data.customerId,
    jobId: data.jobId ?? null,
    number: data.number,
    issuedOn: data.issuedOn,
    dueOn: data.dueOn ?? null,
    taxable: data.taxable,
    vat: data.vat,
    total: data.total,
    advance: data.advance ?? false,
    vatRows: data.vatRows ?? [],
  }
}

/**
 * A Customer's Jobs to pick from, newest first.
 */
async function jobsOf(customerId: number) {
  const jobs = await Job.query()
    .where('customerId', customerId)
    .orderBy([
      { column: 'year', order: 'desc' },
      { column: 'sequence', order: 'desc' },
    ])
  return jobs.map((job) => ({ id: job.id, number: job.number, title: job.title }))
}

/**
 * Active VAT Codes, plus any the Legacy Invoice's rows already use.
 */
async function vatCodeOptions(used: number[]) {
  const codes = await VatCode.query()
    .where((q) => q.withScopes((scopes) => scopes.active()).orWhereIn('id', used))
    .orderBy([
      { column: 'rate', order: 'desc' },
      { column: 'name', order: 'asc' },
    ])
  return codes.map((code) => ({ id: code.id, name: code.name, rate: code.rate }))
}
