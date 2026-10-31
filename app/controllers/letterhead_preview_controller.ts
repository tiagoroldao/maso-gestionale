import DocumentRenderer, { type DocumentInput } from '#documents/document_renderer'
import { PdfConversionError } from '#documents/pdf_converter'
import type { I18n } from '@adonisjs/i18n'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * A sample document in the Base Layout, so the Admin can check how the
 * company letterhead prints.
 */
function sample(i18n: I18n): DocumentInput {
  return {
    title: i18n.t('documents.letterheadPreview.title'),
    recipient: {
      name: 'Mario Rossi',
      addressLines: ['Via Garibaldi, 5', '20121 Milano (MI)'],
      taxCode: 'RSSMRA85T10A562S',
    },
    bodyHtml: i18n.t('documents.letterheadPreview.body'),
  }
}

export default class LetterheadPreviewController {
  async pdf({ response, logger, i18n }: HttpContext) {
    try {
      const pdf = await new DocumentRenderer().renderPdf(sample(i18n))
      response.header('content-type', 'application/pdf')
      response.header('content-disposition', 'inline; filename="anteprima-carta-intestata.pdf"')
      return pdf
    } catch (error) {
      if (!(error instanceof PdfConversionError)) throw error
      logger.warn({ err: error }, 'PDF conversion failed')
      return response.serviceUnavailable(i18n.t('errors.pdfUnavailable'))
    }
  }
}
