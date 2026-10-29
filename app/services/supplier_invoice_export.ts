import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { PassThrough, type Readable } from 'node:stream'
import Big from 'big.js'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import type { I18n } from '@adonisjs/i18n'
import logger from '@adonisjs/core/services/logger'
import SupplierInvoice from '#models/supplier_invoice'
import { GotenbergPdfConverter, type PdfConverter } from '#documents/pdf_converter'
import { supplierInvoiceHtml } from '#documents/supplier_invoice_document'
import { storagePath } from '#services/storage'
import { formatDate } from '#shared/dates'
import { documentTypeLabel } from '#shared/supplier_invoices'

/** The zip's index of the invoices it holds */
const INDEX = 'indice.csv'
const ORIGINALS = 'originali'
const PDFS = 'pdf'

/** The CSV index's columns, in order (`documents.supplierInvoiceExport.columns`) */
export const EXPORT_COLUMNS = [
  'supplier',
  'vatId',
  'documentType',
  'number',
  'issuedOn',
  'taxable',
  'vat',
  'total',
  'currency',
  'sdiIdentifier',
  'receivedVia',
  'originalFile',
  'pdfFile',
] as const

/** One invoice in the export, with the names its files take in the zip */
type ExportEntry = {
  invoice: SupplierInvoice
  /** The original file's name in the zip, or null when it is missing from storage */
  original: string | null
  /** Whether this entry adds the original: a file holding several invoices is added once */
  addsOriginal: boolean
  pdf: string
}

/**
 * Exporting a period's Supplier Invoices for the commercialista (#200):
 * one zip holding each original file as received (XML or .p7m), a PDF
 * rendering of each invoice and a CSV index. The zip is streamed as it
 * is built: one PDF is converted at a time, never the whole archive held
 * in memory.
 */
export default class SupplierInvoiceExport {
  /**
   * The Supplier Invoices issued in the period ("YYYY-MM-DD", both days
   * included), by invoice date, with their lines.
   */
  static invoicesIssuedIn(from: string, to: string) {
    return SupplierInvoice.query()
      .whereBetween('issuedOn', [from, to])
      .preload('lines', (lines) => lines.orderBy('position'))
      .orderBy([
        { column: 'issuedOn', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
  }

  /**
   * The zip of `invoices` (at least one), as a stream. The first PDF is
   * converted before the stream is returned, so Gotenberg being down is a
   * PdfConversionError to report rather than a broken download; a later
   * failure ends the stream with an error, leaving an unreadable zip.
   */
  static async zip(
    invoices: SupplierInvoice[],
    i18n: I18n,
    converter: PdfConverter = new GotenbergPdfConverter()
  ): Promise<Readable> {
    if (!invoices.length) throw new Error('Nothing to export')
    const entries = this.entries(invoices)
    const pdfOf = async (invoice: SupplierInvoice) =>
      converter.convert(await supplierInvoiceHtml(invoice, i18n))
    const firstPdf = await pdfOf(entries[0].invoice)

    const output = new PassThrough()
    const zip = new Zip((error, chunk, final) => {
      if (error) return output.destroy(error)
      output.write(chunk)
      if (final) output.end()
    })
    const add = async (name: string, contents: Uint8Array, compress = true) => {
      const file = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name)
      file.mtime = new Date()
      zip.add(file)
      file.push(contents, true)
      // Wait for the download to catch up before adding more, or to be abandoned
      if (output.writableNeedDrain) {
        await new Promise<void>((resolve) => {
          const done = () => {
            output.off('drain', done).off('close', done)
            resolve()
          }
          output.on('drain', done).on('close', done)
        })
      }
    }

    const write = async () => {
      // A UTF-8 BOM, so Excel reads accented names right
      await add(INDEX, Buffer.from(`\uFEFF${this.csv(entries, i18n)}`, 'utf8'))
      for (const [index, entry] of entries.entries()) {
        if (output.destroyed) return
        if (entry.original && entry.addsOriginal) {
          await add(entry.original, await readFile(storagePath(entry.invoice.filePath)))
        }
        // PDFs are compressed already
        await add(entry.pdf, index === 0 ? firstPdf : await pdfOf(entry.invoice), false)
      }
      zip.end()
    }
    write().catch((error) => {
      if (output.destroyed) return
      logger.error({ err: error }, 'Supplier Invoice export failed while streaming')
      output.destroy(error)
    })
    return output
  }

  /**
   * The CSV index, one row per invoice: semicolon separated, numbers with
   * a decimal comma and dates as dd/mm/yyyy, the way Excel reads a CSV in
   * Italy. Codes made only of digits are written as text formulas so that
   * Excel keeps their leading zeros and doesn't turn them into numbers.
   */
  private static csv(entries: ExportEntry[], i18n: I18n) {
    const t = (key: string) => i18n.t(key)
    const header = EXPORT_COLUMNS.map((column) =>
      csvText(t(`documents.supplierInvoiceExport.columns.${column}`))
    )
    const rows = entries.map(({ invoice, original, pdf }) => {
      const seller = invoice.details.seller
      return [
        csvText(seller.name),
        csvCode(`${seller.vatCountry}${seller.vatNumber}`),
        csvText(documentTypeLabel(invoice.documentType, t)),
        csvCode(invoice.number),
        formatDate(invoice.issuedOn.toISODate()),
        csvAmount(invoice.taxable),
        csvAmount(invoice.vat),
        csvAmount(invoice.total),
        csvText(invoice.currency),
        invoice.sdiIdentifier ? csvCode(invoice.sdiIdentifier) : '',
        csvText(t(`documents.supplierInvoiceExport.receivedVia.${invoice.receivedVia}`)),
        csvText(original ?? t('documents.supplierInvoiceExport.originalMissing')),
        csvText(pdf),
      ]
    })
    return [header, ...rows].map((row) => row.join(';')).join('\r\n') + '\r\n'
  }

  /**
   * Each invoice's file names in the zip: the original under its received
   * name, the PDF by date, supplier and number; repeated names get a
   * suffix.
   */
  private static entries(invoices: SupplierInvoice[]): ExportEntry[] {
    const taken = new Set<string>()
    const originals = new Map<string, string | null>()
    return invoices.map((invoice) => {
      const known = originals.has(invoice.filePath)
      if (!known) {
        const present = existsSync(storagePath(invoice.filePath))
        if (!present) {
          logger.warn({ invoiceId: invoice.id }, 'Supplier Invoice original file missing')
        }
        originals.set(
          invoice.filePath,
          present ? unique(`${ORIGINALS}/${safeName(invoice.fileName)}`, taken) : null
        )
      }
      const seller = invoice.details.seller.name
      const pdfName = [invoice.issuedOn.toISODate(), slug(seller), slug(invoice.number)]
        .filter(Boolean)
        .join('_')
      return {
        invoice,
        original: originals.get(invoice.filePath)!,
        addsOriginal: !known,
        pdf: unique(`${PDFS}/${pdfName}.pdf`, taken),
      }
    })
  }
}

/** A name made unique among `taken` (ignoring case) with -2, -3… before its extension */
function unique(path: string, taken: Set<string>) {
  let candidate = path
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = path.replace(/(\.xml\.p7m|\.p7m|\.xml|\.pdf)?$/i, `-${n}$1`)
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

/** A received file name, without characters Windows refuses in a name */
function safeName(name: string) {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
}

/** Letters, digits and dashes only, for a readable file name */
function slug(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/**
 * A text cell: quoted when it holds a separator, quote or line break,
 * and never read as a formula (a supplier's name comes from its file).
 */
function csvText(value: string) {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** A code: as text, kept as written even when it is only digits */
function csvCode(value: string) {
  return /^\d+$/.test(value) ? `="${value}"` : csvText(value)
}

/** An amount with a decimal comma and no thousands separator: 1234,50 */
function csvAmount(amount: string) {
  return new Big(amount).toFixed(2).replace('.', ',')
}
