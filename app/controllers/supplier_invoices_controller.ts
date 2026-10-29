import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import type Item from '#models/item'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoiceLines from '#services/supplier_invoice_lines'
import SupplierInvoices, { SupplierInvoiceRefusedError } from '#services/supplier_invoices'
import SupplierInvoiceExport from '#services/supplier_invoice_export'
import { lineReceiptRefusal } from '#shared/supplier_invoices'
import { storagePath } from '#services/storage'
import { PdfConversionError } from '#documents/pdf_converter'
import { TIME_ZONE, todayIso } from '#shared/dates'
import {
  pageValidator,
  supplierInvoiceExportValidator,
  supplierInvoiceUploadValidator,
} from '#validators/supplier'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

/**
 * The Supplier Invoice inbox (#198), for Admin and Office: the invoices
 * received, newest first; uploading one (XML or signed .p7m, with no SDI
 * connection needed); its page with a readable rendering and the
 * original file, and its lines to handle (SupplierInvoiceLinesController,
 * #199), which make it handled.
 */
export default class SupplierInvoicesController {
  async index({ request, inertia }: HttpContext) {
    const { page = 1 } = await pageValidator.validate(request.qs())
    const results = await SupplierInvoice.query()
      .preload('supplier')
      .orderBy([
        { column: 'createdAt', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .paginate(page, PER_PAGE)

    return inertia.render('supplier_invoices/index', {
      invoices: results.all().map((invoice) => ({
        id: invoice.id,
        supplier: invoice.supplier.name,
        documentType: invoice.documentType,
        number: invoice.number,
        issuedOn: invoice.issuedOn.toISODate()!,
        total: invoice.total,
        status: invoice.status,
        receivedVia: invoice.receivedVia,
      })),
      pagination: {
        currentPage: results.currentPage,
        lastPage: results.lastPage,
        total: results.total,
      },
    })
  }

  /**
   * Uploads one received file, as downloaded from the Agenzia delle
   * Entrate portal or the supplier's email.
   */
  async store({ request, response, session, i18n, auth }: HttpContext) {
    const { invoice: file } = await request.validateUsing(supplierInvoiceUploadValidator)
    try {
      const created = await SupplierInvoices.receive(
        { contents: await readFile(file.tmpPath!), name: file.clientName },
        { via: 'upload', user: auth.getUserOrFail() }
      )
      session.flash('success', i18n.t('flash.supplierInvoiceUploaded', { count: created.length }))
      return created.length === 1
        ? response.redirect().toRoute('supplier_invoices.show', { id: created[0].id })
        : response.redirect().toRoute('supplier_invoices.index')
    } catch (error) {
      if (!(error instanceof SupplierInvoiceRefusedError)) throw error
      session.flash('error', i18n.t(`flash.supplierInvoiceRefused.${error.reason}`))
      return response.redirect().toRoute('supplier_invoices.index')
    }
  }

  /**
   * The invoice as read, and its lines to handle (#199): each received
   * (onto which Item, how much, at what cost), marked not stock, or still
   * to handle with the Item suggested for it and, when it can only be
   * marked not stock, why.
   */
  async show({ params, inertia }: HttpContext) {
    const invoice = await SupplierInvoice.query()
      .where('id', params.id)
      .preload('supplier')
      .preload('lines', (lines) =>
        lines.orderBy('position').preload('item').preload('stockMovement')
      )
      .firstOrFail()
    const suggestions = await SupplierInvoiceLines.suggestions(invoice, invoice.lines)
    const pickable = (item: Item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      unit: item.unit,
    })
    const today = todayIso()
    const issuedOn = invoice.issuedOn.toISODate()!

    return inertia.render('supplier_invoices/show', {
      invoice: {
        id: invoice.id,
        documentType: invoice.documentType,
        currency: invoice.currency,
        number: invoice.number,
        issuedOn: invoice.issuedOn.toISODate()!,
        taxable: invoice.taxable,
        vat: invoice.vat,
        total: invoice.total,
        status: invoice.status,
        receivedVia: invoice.receivedVia,
        receivedOn: invoice.createdAt.toISODate()!,
        sdiIdentifier: invoice.sdiIdentifier,
        fileName: invoice.fileName,
        supplier: { id: invoice.supplier.id, name: invoice.supplier.name },
        details: invoice.details,
        lines: invoice.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          code: line.code,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          total: line.total,
          vatRate: line.vatRate,
          natura: line.natura,
          outcome: line.outcome,
          item: line.item ? pickable(line.item) : null,
          receipt: line.stockMovement
            ? { quantity: line.stockMovement.quantity, unitCost: line.stockMovement.unitCost }
            : null,
          suggestion: suggestions.has(line.id) ? pickable(suggestions.get(line.id)!) : null,
          refusal: line.outcome === null ? lineReceiptRefusal(invoice, line) : null,
        })),
      },
      // The day goods are received on, unless Office changes it: the invoice's
      receiveOn: issuedOn < today ? issuedOn : today,
    })
  }

  /**
   * The original file, as received. Downloaded, never shown inline: an
   * XML file could carry a stylesheet.
   */
  async file({ params, response }: HttpContext) {
    const invoice = await SupplierInvoice.findOrFail(params.id)
    const path = storagePath(invoice.filePath)
    if (!existsSync(path)) return response.notFound()
    response.header('x-content-type-options', 'nosniff')
    response.header('content-security-policy', 'sandbox')
    return response.attachment(path, invoice.fileName, 'attachment')
  }

  /**
   * The Supplier Invoices issued in a period, for the commercialista
   * (#200): one zip, streamed as it is built, with the original files, a
   * PDF of each and a CSV index.
   */
  async export({ request, response, session, i18n, logger }: HttpContext) {
    const { issuedFrom, issuedTo } = await request.validateUsing(supplierInvoiceExportValidator)
    const from = issuedFrom.setZone(TIME_ZONE).toISODate()!
    const to = issuedTo.setZone(TIME_ZONE).toISODate()!
    const invoices = await SupplierInvoiceExport.invoicesIssuedIn(from, to)
    if (!invoices.length) {
      session.flash('error', i18n.t('flash.supplierInvoiceExportEmpty'))
      return response.redirect().withQs(false).toRoute('supplier_invoices.index')
    }

    let zip: Readable
    try {
      zip = await SupplierInvoiceExport.zip(invoices, i18n)
    } catch (error) {
      if (!(error instanceof PdfConversionError)) throw error
      logger.warn({ err: error }, 'PDF conversion failed')
      session.flash('error', i18n.t('errors.pdfUnavailable'))
      return response.redirect().withQs(false).toRoute('supplier_invoices.index')
    }
    response.header('content-type', 'application/zip')
    response.header(
      'content-disposition',
      `attachment; filename="fatture-passive_${from}_${to}.zip"`
    )
    response.stream(zip)
  }
}
