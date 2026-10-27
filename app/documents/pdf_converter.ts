import env from '#start/env'

/**
 * Turns a self-contained HTML document into a PDF.
 */
export interface PdfConverter {
  convert(html: string): Promise<Buffer>
}

export class PdfConversionError extends Error {}

/**
 * Converts through Gotenberg's Chromium route. The HTML must embed every
 * asset (images as data URIs), since Gotenberg can't reach the app.
 */
export class GotenbergPdfConverter implements PdfConverter {
  constructor(private baseUrl: string = env.get('GOTENBERG_URL')) {}

  async convert(html: string) {
    const form = new FormData()
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
    form.append('preferCssPageSize', 'true')
    form.append('printBackground', 'true')

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/forms/chromium/convert/html`, {
        method: 'POST',
        body: form,
      })
    } catch (error) {
      throw new PdfConversionError(`Gotenberg is unreachable at ${this.baseUrl}`, { cause: error })
    }
    if (!response.ok) {
      throw new PdfConversionError(
        `Gotenberg responded ${response.status}: ${await response.text()}`
      )
    }
    return Buffer.from(await response.arrayBuffer())
  }
}
