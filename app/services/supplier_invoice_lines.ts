import Big from 'big.js'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Category from '#models/category'
import Item from '#models/item'
import StockMovement from '#models/stock_movement'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoiceLine from '#models/supplier_invoice_line'
import type User from '#models/user'
import StockLedger from '#stock/stock_ledger'
import { isBelowMarkup } from '#shared/money'
import {
  descriptionKey,
  lineReceiptRefusal,
  receiptUnitCost,
  unitsDiffer,
  type LineReceiptRefusal,
} from '#shared/supplier_invoices'

/**
 * descriptionKey() in SQL, for the column `column`.
 */
export const DESCRIPTION_KEY_SQL = (column: string) =>
  `lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`

/**
 * Why a change to a line is refused: it can't be received
 * (LineReceiptRefusal), it is already received or marked not stock
 * (`handled`: a line is never received twice), there is nothing to undo
 * (`notHandled`), or the Item is archived (`archivedItem`).
 */
export type LineRefusal = LineReceiptRefusal | 'handled' | 'notHandled' | 'archivedItem'

export class LineRefusedError extends Error {
  constructor(readonly reason: LineRefusal) {
    super(reason)
  }
}

/** What receiving a line did, for Office's warnings */
export type ReceivedLine = {
  item: Item
  movement: StockMovement
  /** The Category's markup when the resale price now earns less than it */
  belowMarkup: string | null
  /** The line's unit of measure differs from the Item's (unitsDiffer()) */
  unitsDiffer: boolean
}

/**
 * Handling a Supplier Invoice's lines (#199): Office receives each into
 * stock onto an Item, or marks it not stock, and the invoice is handled
 * once every line is one or the other. Nothing enters stock by itself.
 *
 * Every change locks the invoice, then the line, then the Item: one
 * change at a time per invoice, so its status can't race, and a line is
 * never received twice.
 */
export default class SupplierInvoiceLines {
  /**
   * The Item suggested for each line still to handle, by line id: an
   * active Item whose supplier code is the line's article code
   * (CodiceArticolo), for the invoice's Supplier, else one not linked to
   * any Supplier; otherwise the Item an earlier line of the Supplier with
   * the same description was received onto; otherwise an active Item with
   * the same description. Office confirms or picks another.
   */
  static async suggestions(invoice: SupplierInvoice, lines: SupplierInvoiceLine[]) {
    const open = lines.filter((line) => line.outcome === null)
    const codes = [...new Set(open.flatMap((line) => (line.code ? [codeKey(line.code)] : [])))]
    const descriptions = [...new Set(open.map((line) => descriptionKey(line.description)))]

    const byCode = codes.length
      ? await Item.query()
          .withScopes((scopes) => scopes.active())
          .whereRaw(`upper(btrim(supplier_code)) IN (${codes.map(() => '?').join(', ')})`, codes)
          .where((query) => query.where('supplierId', invoice.supplierId).orWhereNull('supplierId'))
          // This Supplier's Items first
          .orderByRaw('supplier_id IS NULL, code, id')
      : []

    const earlier: { key: string; item_id: number }[] = descriptions.length
      ? await db
          .from('supplier_invoice_lines as l')
          .join('supplier_invoices as i', 'i.id', 'l.supplier_invoice_id')
          .join('items', 'items.id', 'l.item_id')
          .where('i.supplier_id', invoice.supplierId)
          .where('l.outcome', 'received')
          .whereNull('items.archived_at')
          .whereRaw(
            `${DESCRIPTION_KEY_SQL('l.description')} IN (${descriptions.map(() => '?').join(', ')})`,
            descriptions
          )
          .select(db.raw(`${DESCRIPTION_KEY_SQL('l.description')} AS key`), 'l.item_id')
          // The most recent first
          .orderBy([
            { column: 'l.handled_at', order: 'desc' },
            { column: 'l.id', order: 'desc' },
          ])
      : []

    const byDescription = descriptions.length
      ? await Item.query()
          .withScopes((scopes) => scopes.active())
          .whereRaw(
            `${DESCRIPTION_KEY_SQL('description')} IN (${descriptions.map(() => '?').join(', ')})`,
            descriptions
          )
          .orderByRaw('(supplier_id = ?) IS NOT TRUE, code, id', [invoice.supplierId])
      : []

    const earlierIds = [...new Set(earlier.map((row) => row.item_id))]
    const earlierItems = earlierIds.length ? await Item.query().whereIn('id', earlierIds) : []

    const suggested = new Map<number, Item>()
    for (const line of open) {
      const key = descriptionKey(line.description)
      const earlierId = earlier.find((row) => row.key === key)?.item_id
      const item =
        (line.code && byCode.find((each) => codeKey(each.supplierCode!) === codeKey(line.code!))) ||
        earlierItems.find((each) => each.id === earlierId) ||
        byDescription.find((each) => descriptionKey(each.description) === key)
      if (item) suggested.set(line.id, item)
    }
    return suggested
  }

  /**
   * Receives a line into stock onto an Item: a receipt (carico) of
   * `quantity`, in the Item's unit, at the line's amount divided by it
   * (receiptUnitCost(), after the supplier's discounts). The Item's
   * purchase price follows the most recent receipt (StockLedger.receive);
   * its resale price never changes, and `belowMarkup` says when it now
   * earns less than its Category's markup. The Item gets the invoice's
   * Supplier as its own and the line's article code as its supplier code,
   * each only when it has none (the code only when the Supplier is this
   * one). The line keeps what was changed, for undo().
   */
  static async receive(
    line: SupplierInvoiceLine,
    input: {
      itemId: number
      quantity: string
      occurredOn: DateTime
      reference: string
      user: User
    }
  ): Promise<ReceivedLine> {
    return db.transaction(async (trx) => {
      const { invoice, locked } = await this.lock(trx, line)
      if (locked.outcome !== null) throw new LineRefusedError('handled')
      const refusal = lineReceiptRefusal(invoice, locked)
      if (refusal) throw new LineRefusedError(refusal)

      const item = await Item.query({ client: trx })
        .where('id', input.itemId)
        .forUpdate()
        .firstOrFail()
      if (item.archivedAt) throw new LineRefusedError('archivedItem')
      const priceBefore = item.purchasePrice

      const movement = await StockLedger.receive(item, {
        quantity: input.quantity,
        unitCost: receiptUnitCost(locked.total, input.quantity),
        occurredOn: input.occurredOn,
        reference: input.reference,
        user: input.user,
        client: trx,
      })

      // Read again: the receipt may have changed the purchase price
      const received = await Item.query({ client: trx }).where('id', item.id).firstOrFail()
      received.supplierId ??= invoice.supplierId
      const setSupplierCode =
        received.supplierCode === null &&
        locked.code !== null &&
        received.supplierId === invoice.supplierId
      if (setSupplierCode) received.supplierCode = locked.code
      await received.save()

      locked.merge({
        outcome: 'received',
        itemId: received.id,
        stockMovementId: movement.id,
        previousPurchasePrice: new Big(received.purchasePrice).eq(priceBefore) ? null : priceBefore,
        setSupplierCode,
        handledAt: DateTime.now(),
        handledBy: input.user.id,
      })
      await locked.save()
      await this.settle(trx, invoice, input.user)

      const category = received.categoryId
        ? await Category.find(received.categoryId, { client: trx })
        : null
      const below =
        category &&
        isBelowMarkup(received.purchasePrice, received.resalePrice, category.markupPercent)
      return {
        item: received,
        movement,
        belowMarkup: below ? category.markupPercent : null,
        unitsDiffer: unitsDiffer(locked.unit, received.unit),
      }
    })
  }

  /**
   * Marks a line not stock: shipping, services, consumables not tracked.
   */
  static async markNotStock(line: SupplierInvoiceLine, user: User) {
    await db.transaction(async (trx) => {
      const { invoice, locked } = await this.lock(trx, line)
      if (locked.outcome !== null) throw new LineRefusedError('handled')
      locked.merge({ outcome: 'not_stock', handledAt: DateTime.now(), handledBy: user.id })
      await locked.save()
      await this.settle(trx, invoice, user)
    })
  }

  /**
   * Sets a line back to handle. A received line's receipt stays in the
   * ledger (Stock Movements are never deleted): an adjustment (rettifica)
   * dated today takes its quantity back off stock, with `reason`. What the
   * receipt changed on the Item is put back where nothing changed it
   * since: the purchase price, unless it is no longer the receipt's cost
   * or a more recent receipt set it; the Supplier link and code, unless
   * another line of the Supplier is still received onto the Item
   * (takeBackSupplier()). The invoice is to handle again.
   */
  static async undo(line: SupplierInvoiceLine, input: { reason: string; user: User }) {
    await db.transaction(async (trx) => {
      const { invoice, locked } = await this.lock(trx, line)
      if (locked.outcome === null) throw new LineRefusedError('notHandled')

      if (locked.outcome === 'received') {
        const item = await Item.query({ client: trx })
          .where('id', locked.itemId!)
          .forUpdate()
          .firstOrFail()
        const receipt = await StockMovement.findOrFail(locked.stockMovementId!, { client: trx })
        await StockLedger.adjust(item, {
          quantity: new Big(receipt.quantity).neg().toString(),
          reason: input.reason,
          occurredOn: DateTime.now(),
          reference: receipt.reference,
          user: input.user,
          client: trx,
        })

        if (
          locked.previousPurchasePrice !== null &&
          receipt.unitCost !== null &&
          new Big(item.purchasePrice).eq(receipt.unitCost) &&
          !(await StockLedger.hasNewerCostedReceipt(receipt, trx))
        ) {
          item.purchasePrice = locked.previousPurchasePrice
        }
        await this.takeBackSupplier(trx, item, invoice, locked)
        await item.save()
      }

      locked.merge({
        outcome: null,
        itemId: null,
        stockMovementId: null,
        previousPurchasePrice: null,
        setSupplierCode: false,
        handledAt: null,
        handledBy: null,
      })
      await locked.save()
      await this.settle(trx, invoice, input.user)
    })
  }

  /**
   * Undoing `line`, received onto the Item from the invoice's Supplier:
   * once no other line of the Supplier is received onto the Item, the
   * Supplier link goes (only receipts set it), and so does the supplier
   * code when this line set it and no other line of the Supplier with
   * that code is still received onto the Item. Changes `item`, for the
   * caller to save; the Item is locked, so its lines can't change
   * meanwhile.
   */
  private static async takeBackSupplier(
    trx: TransactionClientContract,
    item: Item,
    invoice: SupplierInvoice,
    line: SupplierInvoiceLine
  ) {
    if (item.supplierId !== invoice.supplierId) return
    const others: { code: string | null }[] = await trx
      .from('supplier_invoice_lines as l')
      .join('supplier_invoices as i', 'i.id', 'l.supplier_invoice_id')
      .where('l.item_id', item.id)
      .where('l.outcome', 'received')
      .where('i.supplier_id', invoice.supplierId)
      .whereNot('l.id', line.id)
      .select('l.code')
    if (!others.length) item.supplierId = null
    if (
      line.setSupplierCode &&
      item.supplierCode === line.code &&
      !others.some((other) => other.code === line.code)
    ) {
      item.supplierCode = null
    }
  }

  /**
   * Locks the line's invoice, then the line, and reads both again.
   */
  private static async lock(trx: TransactionClientContract, line: SupplierInvoiceLine) {
    const invoice = await SupplierInvoice.query({ client: trx })
      .where('id', line.supplierInvoiceId)
      .forUpdate()
      .firstOrFail()
    const locked = await SupplierInvoiceLine.query({ client: trx })
      .where('id', line.id)
      .forUpdate()
      .firstOrFail()
    return { invoice, locked }
  }

  /**
   * With the invoice locked: handled once no line is left to handle, to
   * handle otherwise.
   */
  private static async settle(
    trx: TransactionClientContract,
    invoice: SupplierInvoice,
    user: User
  ) {
    const open = await SupplierInvoiceLine.query({ client: trx })
      .where('supplierInvoiceId', invoice.id)
      .whereNull('outcome')
      .first()
    if (open && invoice.status === 'to_handle') return
    if (!open && invoice.status === 'handled') return
    invoice.merge(
      open
        ? { status: 'to_handle', handledAt: null, handledBy: null }
        : { status: 'handled', handledAt: DateTime.now(), handledBy: user.id }
    )
    await invoice.save()
  }
}

/** A supplier's article code as compared: trimmed, upper case */
function codeKey(code: string) {
  return code.trim().toUpperCase()
}
