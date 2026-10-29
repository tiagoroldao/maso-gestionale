import SupplierInvoiceLine from '#models/supplier_invoice_line'
import SupplierInvoiceLines, { LineRefusedError } from '#services/supplier_invoice_lines'
import { receiveLineValidator } from '#validators/supplier'
import { amountForInput } from '#shared/money'
import { formatQuantity } from '#shared/stock'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Handling a Supplier Invoice's lines (#199), for Admin and Office:
 * receiving one into stock onto an Item, marking it not stock, and
 * undoing either. Each returns to the invoice's page.
 */
export default class SupplierInvoiceLinesController {
  async receive({ params, request, response, session, i18n, auth }: HttpContext) {
    const line = await SupplierInvoiceLine.query()
      .where('id', params.id)
      .preload('supplierInvoice', (invoice) => invoice.preload('supplier'))
      .firstOrFail()
    const data = await request.validateUsing(receiveLineValidator)
    const invoice = line.supplierInvoice

    try {
      const received = await SupplierInvoiceLines.receive(line, {
        ...data,
        reference: i18n
          .t('ui.supplierInvoices.receiptReference', {
            number: invoice.number,
            supplier: invoice.supplier.name,
          })
          .slice(0, 255),
        user: auth.getUserOrFail(),
      })
      session.flash(
        'success',
        i18n.t('flash.supplierInvoiceLineReceived', {
          quantity: formatQuantity(received.movement.quantity),
          unit: received.item.unit,
          code: received.item.code,
        })
      )
      const warnings = [
        received.unitsDiffer &&
          i18n.t('flash.supplierInvoiceLineUnits', {
            lineUnit: line.unit ?? '',
            unit: received.item.unit,
          }),
        received.belowMarkup !== null &&
          i18n.t('flash.supplierInvoiceLineBelowMarkup', {
            code: received.item.code,
            markup: amountForInput(received.belowMarkup).replace(/,00$/, ''),
          }),
      ].filter((warning): warning is string => Boolean(warning))
      if (warnings.length) session.flash('warning', warnings.join(' '))
    } catch (error) {
      if (!(error instanceof LineRefusedError)) throw error
      session.flash('error', i18n.t(`flash.supplierInvoiceLineRefused.${error.reason}`))
    }
    return response.redirect().toRoute('supplier_invoices.show', { id: line.supplierInvoiceId })
  }

  async markNotStock({ params, response, session, i18n, auth }: HttpContext) {
    const line = await SupplierInvoiceLine.findOrFail(params.id)
    try {
      await SupplierInvoiceLines.markNotStock(line, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.supplierInvoiceLineNotStock'))
    } catch (error) {
      if (!(error instanceof LineRefusedError)) throw error
      session.flash('error', i18n.t(`flash.supplierInvoiceLineRefused.${error.reason}`))
    }
    return response.redirect().toRoute('supplier_invoices.show', { id: line.supplierInvoiceId })
  }

  /**
   * Sets a line back to handle; a receipt is taken back off stock by an
   * adjustment, never deleted.
   */
  async undo({ params, response, session, i18n, auth }: HttpContext) {
    const line = await SupplierInvoiceLine.findOrFail(params.id)
    try {
      await SupplierInvoiceLines.undo(line, {
        reason: i18n.t('ui.supplierInvoices.undoReason', { line: line.lineNumber }),
        user: auth.getUserOrFail(),
      })
      session.flash('success', i18n.t('flash.supplierInvoiceLineUndone'))
    } catch (error) {
      if (!(error instanceof LineRefusedError)) throw error
      session.flash('error', i18n.t(`flash.supplierInvoiceLineRefused.${error.reason}`))
    }
    return response.redirect().toRoute('supplier_invoices.show', { id: line.supplierInvoiceId })
  }
}
