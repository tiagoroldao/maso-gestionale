import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { canTransition, isDeletable, type InvoiceStatus } from '#shared/invoice_lifecycle'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

/** The page's form Save submits: the lines sit in the screen, outside the header */
export const INVOICE_FORM = 'invoice-form'

/** What the Invoice screen's actions depend on, worked out by its controller */
export type InvoiceActionState = {
  invoice: { id: number; status: InvoiceStatus; creditNote: boolean; issued: boolean }
  /** Lines can change: a draft, or after a Rejection, with no Submission open */
  editable: boolean
  /** A draft from a Job, which can be organised again (ADR 0018) */
  organisable: boolean
  /** It has saved lines, so it can be finalised */
  hasLines: boolean
  /** A Credit Note can be drafted for it (ADR 0014) */
  canCredit: boolean
  /** The Submission waiting for its upload, its send or SDI's outcome (ADR 0019) */
  openSubmission: {
    submitted: boolean
    automatic: boolean
    sending: boolean
    sentByApp: boolean
  } | null
  /** Other issued Invoices not yet sent to SDI, named before finalising */
  unsubmittedCount: number
}

/**
 * The Invoice screen's actions (docs/ui.md "Actions"), for a draft, an
 * issued Invoice or Credit Note. Each stage has its next step as the
 * primary: finalising a draft (irreversible, so asked first), then
 * preparing its Submission, uploading or sending it, and recording SDI's
 * outcome when Office has to (ADR 0019). While lines can change Save sits
 * beside it, the page's form holding the lines; organising a draft again
 * and deleting it are in "⋯", both asked first. Once issued the PDF is
 * beside them, the prepared XML in "⋯", and crediting a delivered Invoice
 * a secondary action.
 */
export function invoiceActions(state: InvoiceActionState, i18n: I18n) {
  const { invoice, openSubmission: open } = state
  const params = { id: invoice.id }
  const actions: ScreenActionInput[] = []
  const note = invoice.creditNote

  if (canTransition(invoice.status, 'finalise')) {
    const question = i18n.t(
      note ? 'ui.invoices.finaliseCreditNoteConfirm' : 'ui.invoices.finaliseConfirm'
    )
    actions.push({
      name: 'finalise',
      label: i18n.t(note ? 'ui.invoices.finaliseCreditNote' : 'ui.invoices.finalise'),
      rank: 'primary',
      kind: 'post',
      href: urlFor('invoices.finalise', params),
      confirm: state.unsubmittedCount
        ? `${i18n.t('ui.invoices.unsubmittedWarning', { count: state.unsubmittedCount })}\n\n${question}`
        : question,
      disabledReason: state.hasLines ? null : i18n.t('ui.invoices.finaliseNoLines'),
    })
  } else if (canTransition(invoice.status, 'submit') && !open) {
    actions.push({
      name: 'prepareSubmission',
      label: i18n.t('ui.invoices.prepareSubmission'),
      rank: 'primary',
      kind: 'post',
      href: urlFor('invoices.prepare_submission', params),
    })
  } else if (open && !open.submitted && !open.sending) {
    actions.push({
      name: 'confirmSubmission',
      label: i18n.t(open.automatic ? 'ui.invoices.send' : 'ui.invoices.confirmUpload'),
      rank: 'primary',
      kind: 'post',
      href: urlFor('invoices.confirm_submission', params),
      confirm: i18n.t(
        open.automatic ? 'ui.invoices.sendConfirm' : 'ui.invoices.confirmUploadConfirm'
      ),
    })
  }
  if (open?.submitted) {
    // Polled when the app sent it: recorded by hand only when needed
    actions.push({
      name: 'recordOutcome',
      label: i18n.t('ui.invoices.recordOutcome'),
      rank: open.sentByApp ? 'overflow' : 'primary',
      kind: 'dialog',
    })
  }

  if (state.editable) {
    actions.push({
      name: 'save',
      label: i18n.t('ui.invoices.save'),
      rank: 'secondary',
      kind: 'submit',
      form: INVOICE_FORM,
    })
  }
  if (invoice.issued) {
    actions.push({
      name: 'pdf',
      label: i18n.t('ui.invoices.pdf'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('invoices.pdf', params),
      file: 'view',
    })
  }
  if (state.canCredit) {
    actions.push({
      name: 'creditNote',
      label: i18n.t('ui.invoices.newCreditNote'),
      rank: 'secondary',
      kind: 'post',
      href: urlFor('invoices.store_credit_note', params),
    })
  }
  // The file to upload exists once its Submission is prepared
  if (open) {
    actions.push({
      name: 'xml',
      label: i18n.t('ui.invoices.xml'),
      rank: 'overflow',
      kind: 'link',
      href: urlFor('invoices.xml', params),
      file: 'download',
    })
  }
  if (state.editable && state.organisable) {
    // The options first, in the page's dialog, which asks before replacing the sections
    actions.push({
      name: 'organise',
      label: i18n.t('ui.invoices.organise'),
      rank: 'overflow',
      kind: 'dialog',
    })
  }
  if (isDeletable(invoice.status)) {
    actions.push({
      name: 'delete',
      label: i18n.t('ui.invoices.delete'),
      rank: 'overflow',
      kind: 'post',
      method: 'delete',
      href: urlFor('invoices.destroy', params),
      destructive: true,
      confirm: i18n.t(note ? 'ui.invoices.deleteCreditNoteConfirm' : 'ui.invoices.deleteConfirm'),
    })
  }
  return declareActions(actions)
}
