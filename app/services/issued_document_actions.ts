import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

/** The issuing form's id, which the header's "Emetti documento" submits */
export const ISSUED_DOCUMENT_FORM = 'issued-document'

/**
 * Issuing a document, or its replacement (docs/ui.md "Kinds of screen"):
 * the filled template's form is in edit mode, "Emetti documento" its
 * primary. Issuing can't be undone (the document takes its number and is
 * frozen), so it asks first, naming the template and the Customer; the
 * page names the Customer chosen in the form instead, once one is.
 * Choosing the template comes first and has no actions.
 */
export function issuingActions(i18n: I18n, issuing: { template: string; customer: string | null }) {
  return declareActions([
    {
      name: 'save',
      label: i18n.t('ui.issuedDocuments.issue'),
      rank: 'primary',
      kind: 'submit',
      form: ISSUED_DOCUMENT_FORM,
      confirm: issuing.customer
        ? i18n.t('ui.issuedDocuments.issueConfirm', issuing)
        : i18n.t('ui.issuedDocuments.issueConfirmAny', issuing),
    },
  ])
}

/**
 * An Issued Document's actions (docs/ui.md "Actions"): it is frozen, so
 * there is nothing to save. Its PDF, viewed in a new tab, and issuing a
 * replacement, while it hasn't been replaced and its template isn't
 * archived, both secondary.
 */
export function issuedDocumentActions(document: { id: number; canReplace: boolean }, i18n: I18n) {
  const params = { id: document.id }
  const actions: ScreenActionInput[] = [
    {
      name: 'pdf',
      label: i18n.t('ui.issuedDocuments.pdf'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('issued_documents.pdf', params),
      file: 'view',
    },
  ]
  if (document.canReplace) {
    actions.push({
      name: 'replace',
      label: i18n.t('ui.issuedDocuments.replace'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('issued_documents.replace', params),
    })
  }
  return declareActions(actions)
}
