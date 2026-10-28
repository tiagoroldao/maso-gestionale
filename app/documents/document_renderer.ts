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

/**
 * The issuing company's details, when the document must show them as they
 * were (a finalised Invoice, a sent Quote) rather than as Company settings
 * are now.
 */
export type CompanyDetails = Pick<
  CompanySettings,
  | 'name'
  | 'street'
  | 'streetNumber'
  | 'postalCode'
  | 'city'
  | 'province'
  | 'vatNumber'
  | 'taxCode'
  | 'email'
  | 'phone'
>

/**
 * Company settings as a document prints them now, to keep on a document
 * that must not change once it has gone out (a sent Quote).
 */
export function companyDetailsFrom(settings: CompanyDetails): CompanyDetails {
  return {
    name: settings.name,
    street: settings.street,
    streetNumber: settings.streetNumber,
    postalCode: settings.postalCode,
    city: settings.city,
    province: settings.province,
    vatNumber: settings.vatNumber,
    taxCode: settings.taxCode,
    email: settings.email,
    phone: settings.phone,
  }
}

/**
 * The recipient block for anyone with a billing address: a Customer, or
 * the Customer copy on a finalised Invoice.
 */
export function recipientFrom(party: {
  name: string
  street: string
  streetNumber: string | null
  postalCode: string
  city: string
  province: string
  vatNumber: string | null
  taxCode: string | null
}): Recipient {
  return {
    name: party.name,
    addressLines: [
      [party.street, party.streetNumber].filter(Boolean).join(', '),
      `${party.postalCode} ${party.city} (${party.province})`,
    ],
    vatNumber: party.vatNumber,
    taxCode: party.taxCode,
  }
}

export type DocumentInput = {
  title: string
  recipient: Recipient | null
  company?: CompanyDetails
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
    const settings = await CompanySettings.current()
    const company = input.company ?? settings

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
        logoDataUri: await this.logoDataUri(settings.logoFile ?? null),
      },
    })
  }

  async renderPdf(input: DocumentInput) {
    return this.converter.convert(await this.renderHtml(input))
  }

  private companyAddressLines(company: CompanyDetails) {
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
