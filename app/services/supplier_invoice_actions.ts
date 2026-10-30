import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

/** What the Supplier Invoice page's actions depend on, worked out by its controller */
export type SupplierInvoiceActionState = {
  invoice: { id: number; sdiIdentifier: string | null }
  /** Office can send it to legal archiving now (ADR 0019): waiting, with the account archiving */
  archivingRetryable: boolean
}

/**
 * The Supplier Invoice page's actions (docs/ui.md "Actions"): the original
 * file, and sending it to legal archiving when it waits (ADR 0019), both
 * secondary. Sending asks for SDI's identifier first when the invoice has
 * none (an upload), in the page's dialog; otherwise it posts at once. It
 * has no primary: its main work is its lines, each handled in its row.
 */
export function supplierInvoiceActions(state: SupplierInvoiceActionState, i18n: I18n) {
  const { invoice } = state
  const params = { id: invoice.id }
  const actions: ScreenActionInput[] = [
    {
      name: 'file',
      label: i18n.t('ui.supplierInvoices.downloadFile'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('supplier_invoices.file', params),
      file: 'download',
    },
  ]
  if (state.archivingRetryable) {
    actions.push(
      invoice.sdiIdentifier
        ? {
            name: 'archive',
            label: i18n.t('ui.supplierInvoices.legalArchivingSend'),
            rank: 'secondary',
            kind: 'post',
            href: urlFor('supplier_invoices.archive', params),
          }
        : {
            name: 'archive',
            label: i18n.t('ui.supplierInvoices.legalArchivingSend'),
            rank: 'secondary',
            kind: 'dialog',
          }
    )
  }
  return declareActions(actions)
}
