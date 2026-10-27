import env from '#start/env'

/**
 * Turns a self-contained HTML document into a PDF.
 */
export interface PdfConverter {
  convert(html: string): Promise<Buffer>
}

export class PdfConversionError extends Error {}

/**
 * How long a single conversion may take before it is abandoned.
 */
const TIMEOUT_MS = 30_000

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
      response = await fetch(new URL('/forms/chromium/convert/html', this.baseUrl), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new PdfConversionError(`Gotenberg did not respond at ${this.baseUrl}`, { cause: error })
    }
    if (!response.ok) {
      throw new PdfConversionError(
        `Gotenberg responded ${response.status}: ${await response.text()}`
      )
    }
    return Buffer.from(await response.arrayBuffer())
  }
}
