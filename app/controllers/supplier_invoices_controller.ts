import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import Item from '#models/item'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoiceLines from '#services/supplier_invoice_lines'
import SupplierInvoices, { SupplierInvoiceRefusedError } from '#services/supplier_invoices'
import SupplierInvoiceExport from '#services/supplier_invoice_export'
import SupplierInvoiceArchiving, {
  ArchivingRefusedError,
} from '#services/supplier_invoice_archiving'
import { supplierInvoiceActions } from '#services/supplier_invoice_actions'
import { isSdiFailureCode } from '#shared/sdi_failures'
import StockLedger from '#stock/stock_ledger'
import { isArchivingWaiting, lineReceiptRefusal } from '#shared/supplier_invoices'
import { storagePath } from '#services/storage'
import { PdfConversionError } from '#documents/pdf_converter'
import { TIME_ZONE, todayIso } from '#shared/dates'
import {
  pageValidator,
  spreadDiscountsValidator,
  supplierInvoiceArchivingValidator,
  supplierInvoiceExportValidator,
  supplierInvoicePageValidator,
  supplierInvoiceUploadValidator,
} from '#validators/supplier'
import { listActions } from '#services/list_actions'
import { urlFor } from '@adonisjs/core/services/url_builder'
import type { HttpContext } from '@adonisjs/core/http'

const PER_PAGE = 25

/**
 * The Supplier Invoice inbox (#198), for Admin and Office: the invoices
 * received, newest first; uploading one (XML or signed .p7m, with no SDI
 * connection needed); its page with a readable rendering and the
 * original file, and its lines to handle (SupplierInvoiceLinesController,
 * #199), which make it handled; its legal archiving through the SDI
 * intermediary, sent again from its page after a failure (#214).
 */
export default class SupplierInvoicesController {
  async index({ request, inertia, i18n }: HttpContext) {
    const { page = 1 } = await pageValidator.validate(request.qs())
    const results = await SupplierInvoice.query()
      .preload('supplier')
      .orderBy([
        { column: 'createdAt', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .paginate(page, PER_PAGE)

    return inertia.render('supplier_invoices/index', {
      // Uploading is the page's own form; the Suppliers are a link away
      actions: listActions(null, [
        {
          name: 'suppliers',
          label: i18n.t('ui.supplierInvoices.suppliers'),
          href: urlFor('suppliers.index'),
        },
      ]),
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
   * (onto which Item, how much, at what cost), already received (#210),
   * marked not stock, or still to handle. A line to handle comes with the
   * Item suggested for it, or the one Office picked (`pick[lineId]` in the
   * query string), and for that Item the date of its newest receipt with
   * a cost and its recent receipts received by hand (for "già ricevuto"
   * and its hint); its default amount (the discount spread when the
   * invoice says so); and, when it can only be marked not stock, why.
   */
  async show({ params, request, inertia, i18n }: HttpContext) {
    const { pick = {} } = await supplierInvoicePageValidator.validate(request.qs())
    const invoice = await SupplierInvoice.query()
      .where('id', params.id)
      .preload('supplier')
      .preload('lines', (lines) =>
        lines.orderBy('position').preload('item').preload('stockMovement')
      )
      .firstOrFail()
    const suggestions = await SupplierInvoiceLines.suggestions(invoice, invoice.lines)
    const open = invoice.lines.filter((line) => line.outcome === null)
    const pickedIds = open.flatMap((line) => (pick[line.id] ? [pick[line.id]] : []))
    const picked = pickedIds.length
      ? await Item.query()
          .withScopes((scopes) => scopes.active())
          .whereIn('id', pickedIds)
      : []
    const candidates = new Map(
      open.flatMap((line) => {
        const item =
          picked.find((each) => each.id === pick[line.id]) ?? suggestions.get(line.id) ?? null
        return item ? [[line.id, item] as const] : []
      })
    )
    const candidateIds = [...new Set([...candidates.values()].map((item) => item.id))]
    const newestCost = await StockLedger.newestCostDates(candidateIds)
    const manualReceipts = await SupplierInvoiceLines.manualReceipts(invoice, candidateIds)
    const { discount, spreadable, amounts } = SupplierInvoiceLines.defaultAmounts(
      invoice,
      invoice.lines
    )
    const pickable = (item: Item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      unit: item.unit,
    })
    const today = todayIso()
    const issuedOn = invoice.issuedOn.toISODate()!
    // Whether it can be sent to legal archiving now: the account archives (#224)
    const archivingOffered = (await SupplierInvoiceArchiving.gateway()) !== null
    // Office can send it now: waiting, with the account archiving (#224)
    const archivingRetryable = archivingOffered && isArchivingWaiting(invoice.legalArchiving)

    return inertia.render('supplier_invoices/show', {
      // The header's actions (docs/ui.md "Actions")
      actions: supplierInvoiceActions({ invoice, archivingRetryable }, i18n),
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
        spreadDiscounts: invoice.spreadDiscounts,
        // Its file's legal archiving through the intermediary (#214)
        legalArchiving: invoice.legalArchiving
          ? {
              state: invoice.legalArchiving,
              at: invoice.legalArchivingAt!.toISO()!,
              ids: invoice.legalArchivingIds ?? [],
              failure: invoice.legalArchivingFailure,
            }
          : null,
        archivingOffered,
        archivingRetryable,
        // The discount on the whole invoice, and whether it can be spread over its lines
        discount,
        spreadable,
        lines: invoice.lines.map((line) => {
          const candidate = candidates.get(line.id) ?? null
          return {
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
              ? {
                  quantity: line.stockMovement.quantity,
                  unitCost: line.stockMovement.unitCost,
                  occurredOn: line.stockMovement.occurredOn.toISODate()!,
                }
              : null,
            // The cost confirmed for a line already received
            unitCost: line.unitCost,
            suggestion: suggestions.has(line.id) ? pickable(suggestions.get(line.id)!) : null,
            candidate: candidate
              ? { ...pickable(candidate), newestCostOn: newestCost.get(candidate.id) ?? null }
              : null,
            manualReceipts: candidate ? (manualReceipts.get(candidate.id) ?? []) : [],
            defaultAmount: amounts.get(line.id)!,
            refusal: line.outcome === null ? lineReceiptRefusal(invoice, line) : null,
          }
        }),
      },
      picks: Object.fromEntries(
        open.flatMap((line) => (pick[line.id] ? [[String(line.id), pick[line.id]]] : []))
      ),
      // The day goods are received on, unless Office changes it: the invoice's
      receiveOn: issuedOn < today ? issuedOn : today,
    })
  }

  /**
   * Whether the invoice's discounts are spread over its lines' default
   * costs (#210).
   */
  async spreadDiscounts({ params, request, response, session, i18n }: HttpContext) {
    const invoice = await SupplierInvoice.findOrFail(params.id)
    const { spreadDiscounts } = await request.validateUsing(spreadDiscountsValidator)
    await SupplierInvoiceLines.spreadDiscounts(invoice, spreadDiscounts)
    session.flash(
      'success',
      i18n.t(spreadDiscounts ? 'flash.supplierInvoiceSpread' : 'flash.supplierInvoiceNotSpread')
    )
    return response.redirect().toRoute('supplier_invoices.show', { id: invoice.id })
  }

  /**
   * Sends the invoice's file to legal archiving again, after a failure or
   * before the poller does (#214), with SDI's identifier when it has
   * none. The send happens outside any lock.
   */
  async archive({ params, request, response, session, i18n }: HttpContext) {
    const invoice = await SupplierInvoice.findOrFail(params.id)
    const { sdiId } = await request.validateUsing(supplierInvoiceArchivingValidator)
    try {
      const result = await SupplierInvoiceArchiving.retry(invoice, sdiId ?? null)
      if (result.outcome === 'requested') {
        session.flash('success', i18n.t('flash.supplierInvoiceArchived'))
      } else {
        const detail = isSdiFailureCode(result.failure)
          ? i18n.t(`ui.sdiFailures.${result.failure}`)
          : result.failure
        session.flash('error', i18n.t('flash.supplierInvoiceArchivingFailed', { detail }))
      }
    } catch (error) {
      if (!(error instanceof ArchivingRefusedError)) throw error
      session.flash('error', i18n.t(`flash.supplierInvoiceArchivingRefused.${error.reason}`))
    }
    return response.redirect().toRoute('supplier_invoices.show', { id: invoice.id })
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
