import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import edge from 'edge.js'
import CompanySettings from '#models/company_settings'
import { storagePath } from '#services/storage'
import { GotenbergPdfConverter, type PdfConverter } from '#documents/pdf_converter'

/**
 * Who a document is addressed to, as printed in the Base Layout's header.
 * Customers (and later Sites) are mapped into this shape.
 */
export type Recipient = {
  name: string
  addressLines: string[]
  vatNumber?: string | null
  taxCode?: string | null
}

export type DocumentInput = {
  title: string
  recipient: Recipient | null
  /**
   * The document's body. Trusted HTML produced by the app's own templates,
   * inserted without escaping.
   */
  bodyHtml: string
}

const LOGO_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/**
 * Renders documents inside the fixed Base Layout (company letterhead and
 * recipient block) as self-contained HTML, and converts them to PDF.
 */
export default class DocumentRenderer {
  constructor(private converter: PdfConverter = new GotenbergPdfConverter()) {}

  async renderHtml(input: DocumentInput) {
    const company = await CompanySettings.current()

    return edge.render('documents/base_layout', {
      title: input.title,
      recipient: input.recipient,
      bodyHtml: input.bodyHtml,
      company: {
        name: company.name ?? '',
        addressLines: this.companyAddressLines(company),
        vatNumber: company.vatNumber ?? null,
        taxCode: company.taxCode && company.taxCode !== company.vatNumber ? company.taxCode : null,
        email: company.email ?? null,
        phone: company.phone ?? null,
        iban: company.iban ?? null,
        logoDataUri: await this.logoDataUri(company.logoFile ?? null),
      },
    })
  }

  async renderPdf(input: DocumentInput) {
    return this.converter.convert(await this.renderHtml(input))
  }

  private companyAddressLines(company: CompanySettings) {
    const street = [company.street, company.streetNumber].filter(Boolean).join(', ')
    const town = [company.postalCode, company.city, company.province && `(${company.province})`]
      .filter(Boolean)
      .join(' ')
    return [street, town].filter(Boolean)
  }

  private async logoDataUri(file: string | null) {
    if (!file) return null
    const mime = LOGO_MIME_TYPES[extname(file).toLowerCase()]
    if (!mime) return null

    try {
      const contents = await readFile(storagePath(file))
      return `data:${mime};base64,${contents.toString('base64')}`
    } catch {
      return null
    }
  }
}
