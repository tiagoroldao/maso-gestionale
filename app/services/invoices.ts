import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type Customer from '#models/customer'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import Item from '#models/item'
import VatCode from '#models/vat_code'
import { invoiceLineTotal } from '#shared/invoice_totals'

/**
 * The Invoice is no longer a draft, so it can't be changed or deleted.
 */
export class InvoiceNotEditableError extends Error {}

export type InvoiceLineInput = {
  itemId?: number
  description: string
  quantity: string
  unitPrice: string
  discountPercent?: string
  vatCodeId: number
}

/**
 * Draft Invoices: creating, editing and deleting them. Every change locks
 * the Invoice and refuses anything but a draft.
 */
export default class Invoices {
  static create(customer: Customer) {
    return Invoice.create({ customerId: customer.id, status: 'draft' })
  }

  /**
   * Replaces the draft's lines, copying each VAT Code's rate and Natura
   * and each Item's unit onto the line.
   */
  static async save(
    invoice: Invoice,
    input: { discountPercent?: string; notes?: string | null; lines: InvoiceLineInput[] }
  ) {
    await this.whileDraft(invoice, async (trx, locked) => {
      locked.merge({ discountPercent: input.discountPercent ?? '0', notes: input.notes ?? null })
      await locked.save()

      const codes = await VatCode.query({ client: trx }).whereIn(
        'id',
        input.lines.map((line) => line.vatCodeId)
      )
      const vat = new Map(codes.map((code) => [code.id, code]))
      const itemIds = input.lines.flatMap((line) => (line.itemId ? [line.itemId] : []))
      const items = itemIds.length ? await Item.query({ client: trx }).whereIn('id', itemIds) : []
      const units = new Map(items.map((item) => [item.id, item.unit]))

      await InvoiceLine.query({ client: trx }).where('invoiceId', locked.id).delete()
      await InvoiceLine.createMany(
        input.lines.map((line, position) => {
          const code = vat.get(line.vatCodeId)!
          const discountPercent = line.discountPercent ?? '0'
          return {
            invoiceId: locked.id,
            position,
            itemId: line.itemId ?? null,
            description: line.description,
            quantity: line.quantity,
            unit: line.itemId ? (units.get(line.itemId) ?? null) : null,
            unitPrice: line.unitPrice,
            discountPercent,
            vatCodeId: code.id,
            vatRate: code.rate,
            natura: code.natura,
            lineTotal: invoiceLineTotal(line.quantity, line.unitPrice, discountPercent),
          }
        }),
        { client: trx }
      )
    })
  }

  static async destroy(invoice: Invoice) {
    await this.whileDraft(invoice, (_, locked) => locked.delete())
  }

  private static whileDraft<T>(
    invoice: Invoice,
    work: (trx: TransactionClientContract, locked: Invoice) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      const locked = await Invoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      if (locked.status !== 'draft') throw new InvoiceNotEditableError()
      return work(trx, locked)
    })
  }
}
