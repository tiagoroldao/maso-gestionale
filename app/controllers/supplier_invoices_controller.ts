import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoices, { SupplierInvoiceRefusedError } from '#services/supplier_invoices'
import { storagePath } from '#services/storage'
import { pageValidator, supplierInvoiceUploadValidator } from '#validators/supplier'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

/**
 * The Supplier Invoice inbox (#198), for Admin and Office: the invoices
 * received, newest first; uploading one (XML or signed .p7m, with no SDI
 * connection needed); its page with a readable rendering and the
 * original file; and marking it handled.
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

  async show({ params, inertia }: HttpContext) {
    const invoice = await SupplierInvoice.query()
      .where('id', params.id)
      .preload('supplier')
      .preload('lines', (lines) => lines.orderBy('position'))
      .firstOrFail()

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
        })),
      },
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

  async markHandled({ params, response, auth, session, i18n }: HttpContext) {
    const invoice = await SupplierInvoice.findOrFail(params.id)
    await SupplierInvoices.setStatus(invoice, 'handled', auth.getUserOrFail())
    session.flash('success', i18n.t('flash.supplierInvoiceHandled'))
    return response.redirect().toRoute('supplier_invoices.show', { id: invoice.id })
  }

  async markToHandle({ params, response, auth, session, i18n }: HttpContext) {
    const invoice = await SupplierInvoice.findOrFail(params.id)
    await SupplierInvoices.setStatus(invoice, 'to_handle', auth.getUserOrFail())
    session.flash('success', i18n.t('flash.supplierInvoiceToHandle'))
    return response.redirect().toRoute('supplier_invoices.show', { id: invoice.id })
  }
}
