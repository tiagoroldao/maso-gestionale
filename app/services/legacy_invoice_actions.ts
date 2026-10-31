import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

/** The page's form Save submits: its fields sit in the screen's sections, outside the header */
export const LEGACY_INVOICE_FORM = 'legacy-invoice-form'

/** What the Legacy Invoice screen's actions depend on, worked out by its controller */
export type LegacyInvoiceActionState = {
  /** Null while a new one is entered */
  invoice: { id: number } | null
  /** A new one has its Customer: the form is there to fill */
  customerPicked: boolean
  /** Changed or deleted only while nothing depends on it (no Payments, deductions or Credit Notes) */
  editable: boolean
  /** A Credit Note can be drafted for it (#27) */
  canCredit: boolean
}

/**
 * The Legacy Invoice screen's actions (docs/ui.md "Actions"). A new one
 * has Save ("Registra") alone, once its Customer is picked. A saved one is
 * edited in place on its own screen: Save is the primary while nothing
 * depends on it, with the original PDF and a new Credit Note beside it,
 * and deleting it in "⋯", asked first. Once something depends on it, the
 * PDF and the Credit Note remain; the server refuses changes and deleting
 * whatever the screen shows.
 */
export function legacyInvoiceActions(state: LegacyInvoiceActionState, i18n: I18n) {
  const { invoice } = state
  const actions: ScreenActionInput[] = []
  if (!invoice) {
    if (state.customerPicked) {
      actions.push({
        name: 'save',
        label: i18n.t('ui.legacyInvoices.create'),
        rank: 'primary',
        kind: 'submit',
        form: LEGACY_INVOICE_FORM,
      })
    }
    return declareActions(actions)
  }

  const params = { id: invoice.id }
  if (state.editable) {
    actions.push({
      name: 'save',
      label: i18n.t('ui.legacyInvoices.save'),
      rank: 'primary',
      kind: 'submit',
      form: LEGACY_INVOICE_FORM,
    })
  }
  actions.push({
    name: 'pdf',
    label: i18n.t('ui.legacyInvoices.pdf'),
    rank: 'secondary',
    kind: 'link',
    href: urlFor('legacy_invoices.pdf', params),
    file: 'view',
  })
  if (state.canCredit) {
    actions.push({
      name: 'creditNote',
      label: i18n.t('ui.invoices.newCreditNote'),
      rank: 'secondary',
      kind: 'post',
      href: urlFor('invoices.store_credit_note', params),
    })
  }
  if (state.editable) {
    actions.push({
      name: 'delete',
      label: i18n.t('ui.legacyInvoices.delete'),
      rank: 'overflow',
      kind: 'post',
      method: 'delete',
      href: urlFor('legacy_invoices.destroy', params),
      destructive: true,
      confirm: i18n.t('ui.legacyInvoices.deleteConfirm'),
    })
  }
  return declareActions(actions)
}
