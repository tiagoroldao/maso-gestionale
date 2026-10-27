import DocumentRenderer, { type DocumentInput } from '#documents/document_renderer'
import { PdfConversionError } from '#documents/pdf_converter'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * A sample document in the Base Layout, so the Admin can check how the
 * company letterhead prints.
 */
const SAMPLE: DocumentInput = {
  title: 'Letterhead preview',
  recipient: {
    name: 'Mario Rossi',
    addressLines: ['Via Garibaldi, 5', '20121 Milano (MI)'],
    taxCode: 'RSSMRA85T10A562S',
  },
  bodyHtml: `
    <p>This sample shows how invoices and documents will look with the current
    company settings: the letterhead at the top and the recipient block below it.</p>
    <p>Change the company details or the logo in Settings, then download the
    preview again.</p>`,
}

export default class LetterheadPreviewController {
  async show({ response }: HttpContext) {
    response.header('content-type', 'text/html; charset=utf-8')
    return new DocumentRenderer().renderHtml(SAMPLE)
  }

  async pdf({ response }: HttpContext) {
    try {
      const pdf = await new DocumentRenderer().renderPdf(SAMPLE)
      response.header('content-type', 'application/pdf')
      response.header('content-disposition', 'inline; filename="letterhead-preview.pdf"')
      return pdf
    } catch (error) {
      if (!(error instanceof PdfConversionError)) throw error
      return response.serviceUnavailable('The PDF service is not available. Try again shortly.')
    }
  }
}
