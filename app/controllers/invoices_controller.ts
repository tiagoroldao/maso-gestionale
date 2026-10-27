import Customer from '#models/customer'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import VatCode from '#models/vat_code'
import Invoices, { InvoiceNotEditableError } from '#services/invoices'
import { invoiceValidator, newInvoiceValidator } from '#validators/invoice'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Active VAT Codes, plus any the draft's lines already use.
 */
async function vatCodeOptions(used: number[]) {
  const codes = await VatCode.query()
    .where((q) => q.withScopes((scopes) => scopes.active()).orWhereIn('id', used))
    .orderBy([
      { column: 'rate', order: 'desc' },
      { column: 'name', order: 'asc' },
    ])
  return codes.map((code) => ({
    id: code.id,
    name: code.name,
    rate: code.rate,
    natura: code.natura,
  }))
}

/**
 * Draft Invoices without a Job, such as direct sales. Finalising,
 * numbering and SDI come with #19–#21.
 */
export default class InvoicesController {
  async index({ inertia }: HttpContext) {
    const invoices = await Invoice.query()
      .preload('customer')
      .preload('lines')
      .orderBy('created_at', 'desc')

    return inertia.render('invoices/index', {
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        status: invoice.status,
        customer: invoice.customer.displayName,
        createdAt: invoice.createdAt.toISODate()!,
        total: invoice.totals.total,
      })),
    })
  }

  async create({ inertia }: HttpContext) {
    return inertia.render('invoices/create', {})
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const { customerId } = await request.validateUsing(newInvoiceValidator)
    const invoice = await Invoices.create(await Customer.findOrFail(customerId))

    session.flash('success', i18n.t('flash.invoiceCreated'))
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  async edit({ params, inertia }: HttpContext) {
    const invoice = await Invoice.query()
      .where('id', params.id)
      .preload('customer')
      .preload('lines', (lines) => lines.orderBy('position'))
      .firstOrFail()

    return inertia.render('invoices/edit', {
      invoice: {
        id: invoice.id,
        status: invoice.status,
        customer: { id: invoice.customer.id, displayName: invoice.customer.displayName },
        discountPercent: invoice.discountPercent,
        notes: invoice.notes,
        lines: invoice.lines.map((line) => ({
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          vatCodeId: line.vatCodeId,
        })),
      },
      editable: invoice.status === 'draft',
      vatCodes: await vatCodeOptions(invoice.lines.map((line) => line.vatCodeId)),
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    const current = await InvoiceLine.query().where('invoiceId', invoice.id)
    const data = await request.validateUsing(invoiceValidator, {
      meta: {
        itemIds: current.flatMap((line) => (line.itemId ? [line.itemId] : [])),
        vatCodeIds: current.map((line) => line.vatCodeId),
      },
    })

    try {
      await Invoices.save(invoice, {
        discountPercent: data.discountPercent,
        notes: data.notes ?? null,
        lines: data.lines,
      })
    } catch (error) {
      if (!(error instanceof InvoiceNotEditableError)) throw error
      session.flash('error', i18n.t('flash.invoiceNotEditable'))
      return response.redirect().toRoute('invoices.edit', { id: invoice.id })
    }

    session.flash('success', i18n.t('flash.invoiceSaved'))
    response.redirect().toRoute('invoices.edit', { id: invoice.id })
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const invoice = await Invoice.findOrFail(params.id)
    try {
      await Invoices.destroy(invoice)
    } catch (error) {
      if (!(error instanceof InvoiceNotEditableError)) throw error
      session.flash('error', i18n.t('flash.invoiceNotEditable'))
      return response.redirect().toRoute('invoices.edit', { id: invoice.id })
    }

    session.flash('success', i18n.t('flash.invoiceDeleted'))
    response.redirect().toRoute('invoices.index')
  }
}
