import Customer from '#models/customer'
import Job from '#models/job'
import Payment from '#models/payment'
import Payments, { PaymentRefusedError } from '#services/payments'
import { outstanding, paymentStatus } from '#shared/payment_status'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import VatCode from '#models/vat_code'
import Invoices, {
  InvoiceNotEditableError,
  InvoiceNotFinalisableError,
  JobNotInvoiceableError,
} from '#services/invoices'
import DocumentRenderer from '#documents/document_renderer'
import { PdfConversionError } from '#documents/pdf_converter'
import { invoiceDocument } from '#documents/invoice_document'
import InvoiceSubmission from '#models/invoice_submission'
import Submissions, { SubmissionRefusedError } from '#services/submissions'
import { canTransition, isEditable, RESUBMISSION_DAYS } from '#shared/invoice_lifecycle'
import type { I18n } from '@adonisjs/i18n'
import {
  paymentValidator,
  invoiceStageValidator,
  invoiceValidator,
  newInvoiceValidator,
  submissionOutcomeValidator,
} from '#validators/invoice'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The description of the per-rate global discount lines in the XML.
 */
const discountLabel = (invoice: Invoice, i18n: I18n) =>
  i18n.t('documents.invoice.globalDiscountLine', {
    percent: Number(invoice.discountPercent).toLocaleString('it-IT'),
  })

/**
 * Active VAT Codes, plus any the draft's lines already use.
 */
async function vatCodeOptions(used: number[]) {
  const codes = await VatCode.query()
    .where((q) => q.withScopes((scopes) => scopes.active()).orWhereIn('id', used))
    .orderBy([
      { column: 'rate', order: 'desc' },
      { column: 'name', order: 'asc' },
    ])
  return codes.map((code) => ({
    id: code.id,
    name: code.name,
    rate: code.rate,
    natura: code.natura,
  }))
}

/**
 * Invoices without a Job (such as direct sales): drafting, finalising,
 * PDF and XML, and their Submissions to SDI.
 */
export default class InvoicesController {
  /**
   * Invoices by stage: drafts, finalised but not submitted, submitted
   * without an outcome yet, rejected (to correct and resubmit), or all.
   */
  async index({ request, inertia }: HttpContext) {
    const { stage = 'all' } = await invoiceStageValidator.validate(request.qs())
    const query = Invoice.query()
      .preload('customer')
      .preload('lines')
      .preload('payments')
      .orderBy('created_at', 'desc')
    if (stage === 'overdue') {
      // Past due and not fully paid
      query
        .whereNot('status', 'draft')
        .where('dueOn', '<', DateTime.now().toISODate()!)
        .whereRaw(
          'total > (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.invoice_id = invoices.id)'
        )
    } else if (stage !== 'all') query.where('status', stage)
    const today = DateTime.now().toISODate()!
    const invoices = await query

    return inertia.render('invoices/index', {
      stage,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.formattedNumber,
        issuedOn: invoice.issuedOn?.toISODate() ?? null,
        status: invoice.status,
        customer: invoice.customer.displayName,
        createdAt: invoice.createdAt.toISODate()!,
        total: invoice.totals.total,
        payment:
          invoice.total && invoice.dueOn
            ? paymentStatus({
                total: invoice.total,
                paid: invoice.paid,
                dueOn: invoice.dueOn.toISODate()!,
                today,
              })
            : null,
      })),
    })
  }

  async create({ inertia }: HttpContext) {
    return inertia.render('invoices/create', {})
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const { customerId } = await request.validateUsing(newInvoiceValidator)
    const invoice = await Invoices.create(await Customer.findOrFail(customerId))

    session.flash('success', i18n.t('flash.invoiceCreated'))
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  /**
   * A draft Invoice from a Job: its accepted Quote, or its recorded time
   * and materials (or the Job's existing Invoice).
   */
  async storeFromJob({ params, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    try {
      const invoice = await Invoices.fromJob(job)
      session.flash('success', i18n.t('flash.invoiceCreated'))
      return response.redirect().toRoute('invoices.edit', { id: invoice.id })
    } catch (error) {
      if (!(error instanceof JobNotInvoiceableError)) throw error
      session.flash('error', i18n.t('flash.jobNotInvoiceable'))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    }
  }

  async edit({ params, inertia }: HttpContext) {
    const invoice = await Invoice.query()
      .where('id', params.id)
      .preload('customer')
      .preload('job')
      .preload('lines', (lines) => lines.orderBy('position'))
      .preload('submissions', (submissions) => submissions.orderBy('preparedAt'))
      .preload('payments', (payments) => payments.orderBy('paidOn'))
      .firstOrFail()
    const open = invoice.submissions.find((submission) => !submission.outcome) ?? null
    const lastRejection = invoice.submissions.findLast(
      (submission) => submission.outcome === 'rejected'
    )
    // Other Invoices still waiting to go (or go back) to SDI, to warn before finalising
    const unsubmitted = await Invoice.query()
      .whereIn('status', ['finalised', 'rejected'])
      .whereNot('id', invoice.id)
      .count('* as waiting')
      .first()

    return inertia.render('invoices/edit', {
      invoice: {
        id: invoice.id,
        status: invoice.status,
        number: invoice.formattedNumber,
        issuedOn: invoice.issuedOn?.toISODate() ?? null,
        dueOn: invoice.dueOn?.toISODate() ?? null,
        customer: { id: invoice.customer.id, displayName: invoice.customer.displayName },
        job: invoice.job ? { id: invoice.job.id, number: invoice.job.number } : null,
        discountPercent: invoice.discountPercent,
        notes: invoice.notes,
        lines: invoice.lines.map((line) => ({
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          vatCodeId: line.vatCodeId,
        })),
      },
      // Not while a prepared Submission's file may already be on SDI
      editable: isEditable(invoice.status) && !open,
      canSubmit: canTransition(invoice.status, 'submit'),
      submissions: invoice.submissions.map((submission) => ({
        id: submission.id,
        fileName: submission.fileName,
        preparedAt: submission.preparedAt.toISO()!,
        submittedAt: submission.submittedAt?.toISO() ?? null,
        outcome: submission.outcome,
        outcomeAt: submission.outcomeAt?.toISO() ?? null,
        outcomeNotes: submission.outcomeNotes,
      })),
      openSubmission: open
        ? { id: open.id, fileName: open.fileName, submitted: Boolean(open.submittedAt) }
        : null,
      // SDI's window to resubmit after a Rejection
      resubmitBy:
        invoice.status === 'rejected' && lastRejection?.outcomeAt
          ? lastRejection.outcomeAt.plus({ days: RESUBMISSION_DAYS }).toISODate()
          : null,
      unsubmittedCount: Number(unsubmitted?.$extras.waiting ?? 0),
      payments: invoice.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        paidOn: payment.paidOn.toISODate()!,
        note: payment.note,
      })),
      paymentSummary:
        invoice.total && invoice.dueOn
          ? {
              status: paymentStatus({
                total: invoice.total,
                paid: invoice.paid,
                dueOn: invoice.dueOn.toISODate()!,
                today: DateTime.now().toISODate()!,
              }),
              paid: invoice.paid,
              outstanding: outstanding(invoice.total, invoice.paid),
            }
          : null,
      vatCodes: await vatCodeOptions(invoice.lines.map((line) => line.vatCodeId)),
    })
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    const current = await InvoiceLine.query().where('invoiceId', invoice.id)
    const data = await request.validateUsing(invoiceValidator, {
      meta: {
        itemIds: current.flatMap((line) => (line.itemId ? [line.itemId] : [])),
        vatCodeIds: current.map((line) => line.vatCodeId),
      },
    })

    try {
      await Invoices.save(
        invoice,
        { discountPercent: data.discountPercent, notes: data.notes ?? null, lines: data.lines },
        auth.getUserOrFail()
      )
    } catch (error) {
      if (error instanceof InvoiceNotFinalisableError) {
        session.flash('error', i18n.t(`flash.invoiceNotFinalisable.${error.reason}`))
      } else if (error instanceof InvoiceNotEditableError) {
        session.flash('error', i18n.t('flash.invoiceNotEditable'))
      } else {
        throw error
      }
      return response.redirect().toRoute('invoices.edit', { id: invoice.id })
    }

    session.flash('success', i18n.t('flash.invoiceSaved'))
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  async finalise({ params, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    try {
      const finalised = await Invoices.finalise(invoice, auth.getUserOrFail())
      session.flash(
        'success',
        i18n.t('flash.invoiceFinalised', { number: finalised.formattedNumber })
      )
    } catch (error) {
      if (error instanceof InvoiceNotFinalisableError) {
        session.flash('error', i18n.t(`flash.invoiceNotFinalisable.${error.reason}`))
      } else if (error instanceof InvoiceNotEditableError) {
        session.flash('error', i18n.t('flash.invoiceNotEditable'))
      } else {
        throw error
      }
    }
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  /**
   * The finalised Invoice on the Base Layout, with the Customer and
   * company as they were when it was finalised.
   */
  async pdf({ params, response, logger, i18n }: HttpContext) {
    const invoice = await Invoice.query()
      .where('id', params.id)
      .preload('lines', (lines) => lines.orderBy('position'))
      .firstOrFail()
    if (invoice.status === 'draft') return response.notFound()

    try {
      const pdf = await new DocumentRenderer().renderPdf(await invoiceDocument(invoice, i18n))
      response.header('content-type', 'application/pdf')
      response.header(
        'content-disposition',
        `inline; filename="fattura-${invoice.formattedNumber!.replace('/', '-')}.pdf"`
      )
      return pdf
    } catch (error) {
      if (!(error instanceof PdfConversionError)) throw error
      logger.warn({ err: error }, 'PDF conversion failed')
      return response.serviceUnavailable(i18n.t('errors.pdfUnavailable'))
    }
  }

  /**
   * The FatturaPA XML of a finalised Invoice, to upload to SDI. Drafts have
   * none: they aren't fiscal documents yet.
   */
  async xml({ params, response, i18n }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    const submission = await InvoiceSubmission.query()
      .where('invoiceId', invoice.id)
      .whereNull('outcome')
      .first()
    if (!submission) return response.notFound()

    response.header('content-type', 'application/xml; charset=utf-8')
    response.header('content-disposition', `attachment; filename="${submission.fileName}"`)
    return Submissions.xml(invoice, submission, discountLabel(invoice, i18n))
  }

  /**
   * Prepares a Submission: reserves its progressive and file name, so the
   * XML can be downloaded and uploaded to SDI.
   */
  async prepareSubmission({ params, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    await this.refusable({ session, i18n }, () =>
      Submissions.prepare(invoice, auth.getUserOrFail())
    )
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  /**
   * Office confirms the prepared XML was uploaded to SDI.
   */
  async confirmSubmission({ params, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    const done = await this.refusable({ session, i18n }, () =>
      Submissions.confirm(invoice, discountLabel(invoice, i18n), auth.getUserOrFail())
    )
    if (done) session.flash('success', i18n.t('flash.submissionConfirmed'))
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  /**
   * SDI's outcome for the Submission in progress.
   */
  async recordOutcome({ params, request, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    const { outcome, notes } = await request.validateUsing(submissionOutcomeValidator)
    const done = await this.refusable({ session, i18n }, () =>
      Submissions.recordOutcome(invoice, outcome, notes ?? null, auth.getUserOrFail())
    )
    if (done) session.flash('success', i18n.t(`flash.submissionOutcome.${outcome}`))
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  /**
   * Runs a Submission step; a refusal (wrong stage) becomes a message.
   */
  private async refusable(
    { session, i18n }: Pick<HttpContext, 'session' | 'i18n'>,
    work: () => Promise<unknown>
  ) {
    try {
      await work()
      return true
    } catch (error) {
      if (!(error instanceof SubmissionRefusedError)) throw error
      session.flash('error', i18n.t('flash.submissionRefused'))
      return false
    }
  }

  async recordPayment({ params, request, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    const data = await request.validateUsing(paymentValidator)
    try {
      await Payments.record(invoice, data, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.paymentRecorded'))
    } catch (error) {
      if (!(error instanceof PaymentRefusedError)) throw error
      session.flash('error', i18n.t(`flash.paymentRefused.${error.reason}`))
    }
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  async removePayment({ params, response, session, i18n }: HttpContext) {
    const payment = await Payment.findOrFail(params.paymentId)
    await Payments.remove(payment)
    session.flash('success', i18n.t('flash.paymentRemoved'))
    response.redirect().toRoute('invoices.edit', { id: payment.invoiceId })
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    try {
      await Invoices.destroy(invoice)
    } catch (error) {
      if (!(error instanceof InvoiceNotEditableError)) throw error
      session.flash('error', i18n.t('flash.invoiceNotEditable'))
      return response.redirect().toRoute('invoices.edit', { id: invoice.id })
    }

    session.flash('success', i18n.t('flash.invoiceDeleted'))
    response.redirect().toRoute('invoices.index')
  }
}
