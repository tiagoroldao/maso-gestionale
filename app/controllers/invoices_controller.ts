import db from '@adonisjs/lucid/services/db'
import Customer from '#models/customer'
import Job from '#models/job'
import Payment from '#models/payment'
import Payments, { PaymentRefusedError } from '#services/payments'
import { overpaidBy, owed, paymentStatus } from '#shared/payment_status'
import { OWED_SQL } from '#services/job_status'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import VatCode from '#models/vat_code'
import VatDefaults from '#services/vat_defaults'
import Invoices, {
  CreditNoteRefusedError,
  InvoiceNotEditableError,
  InvoiceNotFinalisableError,
  JobNotInvoiceableError,
} from '#services/invoices'
import { creditLeft, creditRefusal, credits } from '#shared/credit_notes'
import { PAYABLE_DOCUMENT_TYPES } from '#shared/payments'
import DocumentRenderer from '#documents/document_renderer'
import { PdfConversionError } from '#documents/pdf_converter'
import { invoiceDocument } from '#documents/invoice_document'
import InvoiceSubmission from '#models/invoice_submission'
import Submissions, {
  NoticeBeforeSubmissionError,
  SubmissionRefusedError,
} from '#services/submissions'
import { formatMoney, sumAmounts } from '#shared/money'
import { formatDate } from '#shared/dates'
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
 * The Invoice types Payments are recorded on (shared/payments.ts).
 */
const PAYABLE_TYPES = [...PAYABLE_DOCUMENT_TYPES]

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
 * The VAT Codes new lines start with: a Job's from the default rules,
 * otherwise the Item's code or the standard rate (VatDefaults).
 */
async function vatDefaultProps(job: Job | null) {
  const standard = await VatDefaults.standard()
  return {
    vatDefaults: job ? await VatDefaults.idsForJob(job) : null,
    standardVatCodeId: standard.id,
  }
}

/**
 * Invoices without a Job (such as direct sales) and Credit Notes:
 * drafting, finalising, PDF and XML, and their Submissions to SDI.
 */
export default class InvoicesController {
  /**
   * Invoices by stage: drafts, finalised but not submitted, submitted
   * without an outcome yet, rejected (to correct and resubmit), or all;
   * or by payment: overdue, or overpaid (to refund or correct).
   */
  async index({ request, inertia }: HttpContext) {
    const { stage = 'all' } = await invoiceStageValidator.validate(request.qs())
    const query = Invoice.query()
      .preload('customer')
      .preload('lines')
      .preload('payments')
      .preload('creditNotes')
      .orderBy('created_at', 'desc')
    // As paymentStatus(): overdue when past due with something owed,
    // overpaid when what is owed is below zero; nothing is paid on a
    // Credit Note (Legacy Invoices are paid as any other)
    if (stage === 'overdue') {
      query
        .whereIn('documentType', PAYABLE_TYPES)
        .whereNot('status', 'draft')
        .where('dueOn', '<', DateTime.now().toISODate()!)
        .whereRaw(`${OWED_SQL('invoices')} > 0`)
    } else if (stage === 'overpaid') {
      query
        .whereIn('documentType', PAYABLE_TYPES)
        .whereNot('status', 'draft')
        .whereRaw(`${OWED_SQL('invoices')} < 0`)
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
        documentType: invoice.documentType,
        customer: invoice.customer.displayName,
        createdAt: invoice.createdAt.toISODate()!,
        total: invoice.totals.total,
        payment:
          invoice.total && invoice.dueOn
            ? paymentStatus({
                total: invoice.total,
                credited: invoice.credited,
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
   * A draft Invoice from a Job's Charges to bill, whether or not it has
   * Quotes (ADR 0012), or the Job's existing draft.
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

  /**
   * A draft Credit Note for an Invoice SDI delivered or could not deliver,
   * or its existing draft one.
   */
  async storeCreditNote({ params, response, session, i18n }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    try {
      const creditNote = await Invoices.createCreditNote(invoice)
      session.flash('success', i18n.t('flash.creditNoteCreated'))
      return response.redirect().toRoute('invoices.edit', { id: creditNote.id })
    } catch (error) {
      if (!(error instanceof CreditNoteRefusedError)) throw error
      session.flash('error', i18n.t(`flash.creditNoteRefused.${error.reason}`))
      return response.redirect().toRoute('invoices.edit', { id: invoice.id })
    }
  }

  /**
   * A draft Advance Invoice for part of a Job, for Office to price.
   */
  async storeAdvance({ params, response, session, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    try {
      const invoice = await Invoices.createAdvance(job)
      session.flash('success', i18n.t('flash.invoiceCreated'))
      return response.redirect().toRoute('invoices.edit', { id: invoice.id })
    } catch (error) {
      if (!(error instanceof JobNotInvoiceableError)) throw error
      session.flash('error', i18n.t('flash.jobNotInvoiceable'))
      return response.redirect().toRoute('jobs.show', { id: job.id })
    }
  }

  async edit({ params, inertia, response }: HttpContext) {
    // A Legacy Invoice has its own page: no lines, no SDI (#27)
    const found = await Invoice.findOrFail(params.id)
    if (found.isLegacy) return response.redirect().toRoute('legacy_invoices.show', { id: found.id })
    const invoice = await Invoice.query()
      .where('id', params.id)
      .preload('customer')
      .preload('job')
      .preload('lines', (lines) =>
        lines
          .orderBy('position')
          .preload('item')
          .preload('charges', (charges) => charges.orderBy('id'))
      )
      .preload('submissions', (submissions) => submissions.orderBy('preparedAt'))
      .preload('payments', (payments) => payments.orderBy('paidOn'))
      .preload('creditNotes', (notes) => notes.orderBy('id'))
      .preload('creditedInvoice', (credited) => credited.preload('creditNotes'))
      .firstOrFail()
    // A Credit Note's Invoice, and what is left of it to credit besides
    // this Credit Note
    const credited = invoice.isCreditNote ? invoice.creditedInvoice : null
    const creditedByOthers = credited
      ? sumAmounts(
          credited.creditNotes
            .filter((note) => note.id !== invoice.id && credits(note.status))
            .map((note) => note.total!)
        )
      : null
    const open = invoice.submissions.find((submission) => !submission.outcome) ?? null
    const lastRejection = invoice.submissions.findLast(
      (submission) => submission.outcome === 'rejected'
    )
    // A Job's Invoice takes back issued advances: those with something
    // left, and those it already takes back (ADR 0011)
    const deductions = await db.from('advance_deductions').where('invoice_id', invoice.id)
    const deducted = new Map(
      deductions.map((row) => [row.advance_id as number, row.amount as string])
    )
    const advances =
      invoice.jobId && !invoice.advance
        ? await Invoices.advancesOf(undefined, invoice.jobId, invoice.id)
        : null
    // An advance is credited only for what is left to take back of it,
    // besides this Credit Note (ADR 0014)
    const advanceOf = async (advance: Invoice, except: number | null) => {
      if (!advance.advance || !advance.jobId || advance.status === 'draft') return undefined
      const entries = await Invoices.advancesOf(undefined, advance.jobId, except)
      return entries.find((entry) => entry.advance.id === advance.id)
    }
    const creditedAdvance = credited ? await advanceOf(credited, invoice.id) : undefined
    const ownAdvance = await advanceOf(invoice, null)
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
        advance: invoice.advance,
        documentType: invoice.documentType,
        credits: credited
          ? {
              id: credited.id,
              number: credited.formattedNumber!,
              issuedOn: credited.issuedOn!.toISODate()!,
              total: credited.total!,
              left: creditLeft(
                credited.total!,
                creditedByOthers!,
                creditedAdvance?.deducted ?? '0'
              ),
            }
          : null,
        discountPercent: invoice.discountPercent,
        notes: invoice.notes,
        lines: invoice.lines.map((line) => ({
          id: line.id,
          creditsLineId: line.creditsLineId,
          vatRate: line.vatRate,
          natura: line.natura,
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          vatCodeId: line.vatCodeId,
          significantGood: line.item?.significantGood ?? false,
          deductsInvoiceId: line.deductsInvoiceId,
          chargeIds: line.charges.map((charge) => charge.id),
        })),
      },
      // Not while a prepared Submission's file may already be on SDI
      editable: isEditable(invoice.status) && !open,
      // An Invoice's Credit Notes, and whether another can be issued
      creditNotes: invoice.isCreditNote
        ? null
        : invoice.creditNotes.map((note) => ({
            id: note.id,
            number: note.formattedNumber,
            status: note.status,
            total: note.total,
          })),
      canCredit: creditRefusal(invoice) === null && (!ownAdvance || Number(ownAdvance.left) > 0),
      canSubmit: canTransition(invoice.status, 'submit'),
      submissions: invoice.submissions.map((submission) => ({
        id: submission.id,
        fileName: submission.fileName,
        preparedAt: submission.preparedAt.toISO()!,
        submittedAt: submission.submittedAt?.toISO() ?? null,
        outcome: submission.outcome,
        noticeOn: submission.noticeOn?.toISODate() ?? null,
        sdiId: submission.sdiId,
        outcomeNotes: submission.outcomeNotes,
        hasFile: submission.xml !== null,
      })),
      openSubmission: open
        ? { id: open.id, fileName: open.fileName, submitted: Boolean(open.submittedAt) }
        : null,
      // SDI's window to resubmit after a Rejection, from its notice
      resubmitBy:
        invoice.status === 'rejected' && lastRejection?.noticeOn
          ? lastRejection.noticeOn.plus({ days: RESUBMISSION_DAYS }).toISODate()
          : null,
      unsubmittedCount: Number(unsubmitted?.$extras.waiting ?? 0),
      deductions:
        advances
          ?.map(({ advance, left }) => ({
            advanceId: advance.id,
            number: advance.formattedNumber!,
            total: advance.total!,
            left,
            amount: deducted.get(advance.id) ?? null,
          }))
          .filter((row) => Number(row.left) > 0 || row.amount !== null) ?? null,
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
                credited: invoice.credited,
                paid: invoice.paid,
                dueOn: invoice.dueOn.toISODate()!,
                today: DateTime.now().toISODate()!,
              }),
              credited: invoice.credited,
              paid: invoice.paid,
              // Below zero when overpaid
              owed: owed({ total: invoice.total, credited: invoice.credited, paid: invoice.paid }),
              overpaidBy: overpaidBy({
                total: invoice.total,
                credited: invoice.credited,
                paid: invoice.paid,
              }),
            }
          : null,
      vatCodes: await vatCodeOptions(invoice.lines.map((line) => line.vatCodeId)),
      ...(await vatDefaultProps(invoice.job)),
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
      const { belowPaid, creditedOverpaidBy } = await Invoices.save(
        invoice,
        {
          discountPercent: data.discountPercent,
          notes: data.notes ?? null,
          lines: data.lines,
          deductions: data.deductions,
        },
        auth.getUserOrFail()
      )
      // Saved all the same: the Invoice is now overpaid (ADR 0014)
      if (belowPaid) {
        session.flash('warning', i18n.t('flash.invoiceBelowPaid', { paid: formatMoney(belowPaid) }))
      } else if (creditedOverpaidBy) {
        const credited = await Invoice.findOrFail(invoice.creditsInvoiceId)
        session.flash(
          'warning',
          `${i18n.t('flash.invoiceSaved')} ${i18n.t('flash.creditNoteOverpaid', {
            number: credited.formattedNumber,
            amount: formatMoney(creditedOverpaidBy),
          })}`
        )
      } else {
        session.flash('success', i18n.t('flash.invoiceSaved'))
      }
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

  async finalise({ params, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    try {
      const finalised = await Invoices.finalise(invoice, auth.getUserOrFail())
      if (finalised.isCreditNote) {
        await this.flashCreditNoteFinalised(finalised, { session, i18n })
      } else {
        session.flash(
          'success',
          i18n.t('flash.invoiceFinalised', { number: finalised.formattedNumber })
        )
      }
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
   * A Credit Note issued: its number, and a warning when the Invoice it
   * credits is now overpaid, so Office refunds the Customer (a negative
   * Payment on that Invoice, ADR 0014).
   */
  private async flashCreditNoteFinalised(
    creditNote: Invoice,
    { session, i18n }: Pick<HttpContext, 'session' | 'i18n'>
  ) {
    const credited = await Invoice.findOrFail(creditNote.creditsInvoiceId)
    const by = await db.transaction((trx) => Invoices.overpaidBy(trx, credited.id))
    const done = i18n.t('flash.creditNoteFinalised', { number: creditNote.formattedNumber })
    if (by) {
      session.flash(
        'warning',
        `${done} ${i18n.t('flash.creditNoteOverpaid', {
          number: credited.formattedNumber,
          amount: formatMoney(by),
        })}`
      )
    } else {
      session.flash('success', done)
    }
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
    // A Legacy Invoice's PDF is the original, as uploaded (#27)
    if (invoice.isLegacy) {
      return response.redirect().toRoute('legacy_invoices.pdf', { id: invoice.id })
    }

    try {
      const pdf = await new DocumentRenderer().renderPdf(await invoiceDocument(invoice, i18n))
      response.header('content-type', 'application/pdf')
      response.header(
        'content-disposition',
        `inline; filename="${invoice.isCreditNote ? 'nota-di-credito' : 'fattura'}-${invoice.formattedNumber!.replace('/', '-')}.pdf"`
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
   * The file a Submission sent, exactly as it went to SDI, for archiving.
   */
  async submissionXml({ params, response }: HttpContext) {
    const submission = await InvoiceSubmission.query()
      .where('id', params.submissionId)
      .where('invoiceId', params.id)
      .whereNotNull('xml')
      .firstOrFail()

    response.header('content-type', 'application/xml; charset=utf-8')
    response.header('content-disposition', `attachment; filename="${submission.fileName}"`)
    return submission.xml
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
    const { outcome, noticeOn, sdiId, notes } = await request.validateUsing(
      submissionOutcomeValidator
    )
    try {
      const done = await this.refusable({ session, i18n }, () =>
        Submissions.recordOutcome(
          invoice,
          { outcome, noticeOn, sdiId, notes },
          auth.getUserOrFail()
        )
      )
      if (done) session.flash('success', i18n.t(`flash.submissionOutcome.${outcome}`))
    } catch (error) {
      if (!(error instanceof NoticeBeforeSubmissionError)) throw error
      session.flash('error', i18n.t('flash.noticeBeforeSubmission'))
    }
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

  /**
   * Records a Payment, or a refund as a negative amount. Anything unusual
   * is recorded with a warning, never refused (ADR 0014).
   */
  async recordPayment({ params, request, response, session, i18n, auth }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    const data = await request.validateUsing(paymentValidator)
    try {
      const { warnings } = await Payments.record(invoice, data, auth.getUserOrFail())
      if (warnings.length) {
        const parts = warnings.map((warning) =>
          warning.reason === 'beforeIssued'
            ? i18n.t('flash.paymentWarning.beforeIssued', { date: formatDate(warning.date) })
            : i18n.t(`flash.paymentWarning.${warning.reason}`, {
                amount: formatMoney(warning.amount),
              })
        )
        session.flash('warning', [i18n.t('flash.paymentWarning.recorded'), ...parts].join(' '))
      } else {
        session.flash('success', i18n.t('flash.paymentRecorded'))
      }
    } catch (error) {
      if (!(error instanceof PaymentRefusedError)) throw error
      session.flash('error', i18n.t('flash.paymentRefused'))
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
