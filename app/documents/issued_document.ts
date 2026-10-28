import type { I18n } from '@adonisjs/i18n'
import DocumentTemplateVersion from '#models/document_template_version'
import IssuedDocument from '#models/issued_document'
import type { DocumentInput } from '#documents/document_renderer'
import { formatDate } from '#shared/dates'
import { renderTemplateBody } from '#shared/document_templates'

/**
 * An Issued Document on the Base Layout, printed only from what it froze:
 * the template version it used (never changed), its values and tables,
 * the Recipient and the company details as they were.
 */
export async function issuedDocument(document: IssuedDocument, i18n: I18n): Promise<DocumentInput> {
  const version = await DocumentTemplateVersion.findOrFail(document.documentTemplateVersionId)
  const original = await IssuedDocument.findBy('replacedById', document.id)
  // Only numbers and dates: nothing a user typed reaches this markup
  const replaces = original
    ? `<p>${i18n.t('documents.issued.replaces', {
        number: original.number,
        date: formatDate(original.issuedOn.toISODate()),
      })}</p>`
    : ''

  return {
    title: i18n.t('documents.issued.title', {
      name: version.name,
      number: document.number,
      date: formatDate(document.issuedOn.toISODate()),
    }),
    recipient: document.recipient,
    company: document.company,
    bodyHtml: replaces + renderTemplateBody(version.body, document.values, document.tables),
  }
}
