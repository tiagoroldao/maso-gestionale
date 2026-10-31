import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions, saveActions, type ScreenActionInput } from '#shared/screen_actions'

/** The issuing form's id, which the header's "Emetti documento" submits */
export const ISSUED_DOCUMENT_FORM = 'issued-document'

/**
 * Issuing a document, or its replacement (docs/ui.md "Kinds of screen"):
 * the filled template's form is in edit mode, "Emetti documento" its
 * primary. Choosing the template comes first and has no actions.
 */
export function issuingActions(i18n: I18n) {
  return saveActions(i18n.t('ui.issuedDocuments.issue'), ISSUED_DOCUMENT_FORM)
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
