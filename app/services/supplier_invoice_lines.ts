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
import { addDays, todayIso } from '#shared/dates'
import {
  defaultLineAmounts,
  descriptionKey,
  lineReceiptRefusal,
  newerCostExists,
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
 * (LineReceiptRefusal), it is already handled (`handled`: a line is never
 * received twice), there is nothing to undo (`notHandled`), the Item is
 * archived (`archivedItem`), or the earlier receipt to link isn't one of
 * the Item's received by hand and free (`receiptNotLinkable`).
 */
export type LineRefusal =
  LineReceiptRefusal | 'handled' | 'notHandled' | 'archivedItem' | 'receiptNotLinkable'

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

/** What marking a line already received did, for Office's warnings */
export type AlreadyReceivedLine = Omit<ReceivedLine, 'movement' | 'unitsDiffer'>

/**
 * The cost and purchase price Office confirms when receiving a line or
 * marking it already received (#210): the unit cost to record (left out:
 * the line's default amount over the quantity, defaultLineAmounts() and
 * receiptUnitCost(); zero: none), and whether it becomes the Item's
 * purchase price (left out: only when no newer receipt has a cost).
 */
export type ConfirmedCost = {
  quantity: string
  unitCost?: string | null
  updatePurchasePrice?: boolean
}

/**
 * A receipt received by hand (on the Item's page, not from an invoice
 * line), not linked to any line, that a line can be marked already
 * received against.
 */
export type ManualReceipt = {
  id: number
  occurredOn: string
  quantity: string
  unitCost: string | null
  reference: string | null
  /** A newer receipt of the Item has a cost: the purchase price switch starts off */
  newerCost: boolean
}

/** How many of an Item's recent manual receipts a line offers to link */
const MANUAL_RECEIPTS_SHOWN = 10

/** "Recent", without delivery notes on the invoice: the last 30 days */
const RECENT_DAYS = 30

/**
 * Handling a Supplier Invoice's lines (#199): Office receives each into
 * stock onto an Item, marks it already received by hand onto one (#210),
 * or marks it not stock, and the invoice is handled once every line has
 * one of these three outcomes. Nothing enters stock by itself.
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
   * the same description was received onto (or marked already received
   * onto); otherwise an active Item with
   * the same description. Never an Item linked to another Supplier. Office
   * confirms or picks another.
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
          .whereIn('l.outcome', ['received', 'already_received'])
          .whereNull('items.archived_at')
          .where((query) =>
            query.where('items.supplier_id', invoice.supplierId).orWhereNull('items.supplier_id')
          )
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
          .where((query) => query.where('supplierId', invoice.supplierId).orWhereNull('supplierId'))
          // This Supplier's Items first
          .orderByRaw('supplier_id IS NULL, code, id')
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
   * Each line's default amount (defaultLineAmounts()): its own, less its
   * part of the invoice's discount when the invoice spreads it; with the
   * discount itself and whether it can be spread.
   */
  static defaultAmounts(invoice: SupplierInvoice, lines: SupplierInvoiceLine[]) {
    return defaultLineAmounts(
      {
        documentType: invoice.documentType,
        currency: invoice.currency,
        spread: invoice.spreadDiscounts,
      },
      invoice.details.discounts,
      lines
    )
  }

  /**
   * Since when a receipt counts as recent for the invoice (#210): its
   * earliest delivery note (DatiDDT), or else the last 30 days.
   */
  static recentSince(invoice: SupplierInvoice) {
    const dates = invoice.details.deliveryNotes.map((note) => note.date).sort()
    return dates[0] ?? addDays(todayIso(), -RECENT_DAYS)
  }

  /**
   * The given Items' recent receipts received by hand and linked to no
   * line (ManualReceipt), newest first and at most ten each, by Item id:
   * what a line can be marked already received against, and the hint on
   * the page.
   */
  static async manualReceipts(invoice: SupplierInvoice, itemIds: number[]) {
    const found = new Map<number, ManualReceipt[]>()
    if (!itemIds.length) return found
    const since = this.recentSince(invoice)
    const receipts = await StockMovement.query()
      .whereIn('itemId', itemIds)
      .where('kind', 'receipt')
      .where('occurredOn', '>=', since)
      .orderBy([
        { column: 'occurredOn', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
    const linkedLines = await SupplierInvoiceLine.query()
      .whereIn(
        'stockMovementId',
        receipts.map((receipt) => receipt.id)
      )
      .select('stockMovementId')
    const linked = new Set(linkedLines.map((line) => line.stockMovementId))
    // A newer receipt with a cost is within the period too: compare with those
    const newer = (receipt: StockMovement) =>
      receipts.some(
        (other) =>
          other.itemId === receipt.itemId &&
          other.id !== receipt.id &&
          other.unitCost !== null &&
          (other.occurredOn > receipt.occurredOn ||
            (other.occurredOn.hasSame(receipt.occurredOn, 'day') && other.id > receipt.id))
      )
    for (const receipt of receipts) {
      if (receipt.supplierInvoiceLineId !== null || linked.has(receipt.id)) continue
      const list = found.get(receipt.itemId) ?? []
      if (list.length >= MANUAL_RECEIPTS_SHOWN) continue
      list.push({
        id: receipt.id,
        occurredOn: receipt.occurredOn.toISODate()!,
        quantity: receipt.quantity,
        unitCost: receipt.unitCost,
        reference: receipt.reference,
        newerCost: newer(receipt),
      })
      found.set(receipt.itemId, list)
    }
    return found
  }

  /**
   * Receives a line into stock onto an Item: a receipt (carico) of
   * `quantity`, in the Item's unit, at the cost Office confirmed
   * (ConfirmedCost; by default the line's amount, less its part of the
   * invoice's discount when spread, divided by the quantity). That cost
   * becomes the Item's purchase price when Office says so, and by default
   * only when this is its most recent receipt (StockLedger.receive); the
   * resale price never changes, and `belowMarkup` says when it now earns
   * less than its Category's markup. The Item gets the invoice's Supplier
   * as its own and the line's article code as its supplier code, each
   * only when it has none (linkSupplier()). The line keeps what was
   * changed, for undo().
   */
  static async receive(
    line: SupplierInvoiceLine,
    input: ConfirmedCost & {
      itemId: number
      occurredOn: DateTime
      reference: string
      user: User
    }
  ): Promise<ReceivedLine> {
    return db.transaction(async (trx) => {
      const { invoice, locked, item } = await this.lockToHandle(trx, line, input.itemId)
      const priceBefore = item.purchasePrice

      const movement = await StockLedger.receive(item, {
        quantity: input.quantity,
        unitCost: await this.confirmedCost(trx, invoice, locked, input),
        purchasePrice: priceRule(input.updatePurchasePrice),
        supplierInvoiceLineId: locked.id,
        occurredOn: input.occurredOn,
        reference: input.reference,
        user: input.user,
        client: trx,
      })

      // Read again: the receipt may have changed the purchase price
      const received = await Item.query({ client: trx }).where('id', item.id).firstOrFail()
      const setSupplierCode = this.linkSupplier(received, invoice, locked)
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

      return {
        item: received,
        movement,
        belowMarkup: await this.belowMarkup(trx, received),
        unitsDiffer: unitsDiffer(locked.unit, received.unit),
      }
    })
  }

  /**
   * Marks a line already received (#210): the goods came in earlier and
   * were received by hand onto the Item, so stock doesn't move. The line
   * may name that earlier receipt (`receiptId`): one of the Item's,
   * received by hand and linked to no other line. The cost Office
   * confirmed (ConfirmedCost, where `quantity` only works out the default)
   * is kept on the line, and given to the earlier receipt when it has
   * none. It becomes the Item's purchase price when Office says so, and by
   * default only when no newer receipt has a cost: newer than the earlier
   * receipt, or than the invoice's date without one. The Supplier link and
   * code, and the markup warning, are as for receive().
   */
  static async markAlreadyReceived(
    line: SupplierInvoiceLine,
    input: ConfirmedCost & { itemId: number; receiptId?: number | null; user: User }
  ): Promise<AlreadyReceivedLine> {
    return db.transaction(async (trx) => {
      const { invoice, locked, item } = await this.lockToHandle(trx, line, input.itemId)
      const priceBefore = item.purchasePrice
      const cost = await this.confirmedCost(trx, invoice, locked, input)
      const receipt = input.receiptId
        ? await this.linkableReceipt(trx, input.receiptId, item)
        : null

      const setReceiptCost = receipt !== null && receipt.unitCost === null && cost !== null
      if (setReceiptCost) {
        receipt!.unitCost = cost
        await receipt!.save()
      }

      const update =
        input.updatePurchasePrice ?? !(await this.newerCost(trx, invoice, item, receipt))
      if (cost !== null && update) item.purchasePrice = cost
      const setSupplierCode = this.linkSupplier(item, invoice, locked)
      await item.save()

      locked.merge({
        outcome: 'already_received',
        itemId: item.id,
        stockMovementId: receipt?.id ?? null,
        unitCost: cost,
        setReceiptCost,
        previousPurchasePrice: new Big(item.purchasePrice).eq(priceBefore) ? null : priceBefore,
        setSupplierCode,
        handledAt: DateTime.now(),
        handledBy: input.user.id,
      })
      await locked.save()
      await this.settle(trx, invoice, input.user)

      return { item, belowMarkup: await this.belowMarkup(trx, item) }
    })
  }

  /**
   * Whether the invoice spreads its discounts over its lines' default
   * costs (#210). Lines already handled keep what was recorded.
   */
  static async spreadDiscounts(invoice: SupplierInvoice, spread: boolean) {
    await db.transaction(async (trx) => {
      const locked = await SupplierInvoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .firstOrFail()
      locked.spreadDiscounts = spread
      await locked.save()
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
   * dated today takes its quantity back off stock, with `reason`. A line
   * already received moves no stock: its earlier receipt loses the cost
   * the line gave it, if it had none before, and is free to link again.
   *
   * What either changed on the Item is put back where nothing changed it
   * since: the purchase price, unless it is no longer the line's cost or
   * a more recent receipt with a cost exists (for a line already received
   * without a receipt, one dated after the invoice); the Supplier link and
   * code, unless another line of the Supplier is still received onto the
   * Item (takeBackSupplier()). The invoice is to handle again.
   */
  static async undo(line: SupplierInvoiceLine, input: { reason: string; user: User }) {
    await db.transaction(async (trx) => {
      const { invoice, locked } = await this.lock(trx, line)
      if (locked.outcome === null) throw new LineRefusedError('notHandled')

      if (locked.outcome === 'received' || locked.outcome === 'already_received') {
        const item = await Item.query({ client: trx })
          .where('id', locked.itemId!)
          .forUpdate()
          .firstOrFail()
        const receipt = locked.stockMovementId
          ? await StockMovement.query({ client: trx })
              .where('id', locked.stockMovementId)
              .forUpdate()
              .firstOrFail()
          : null

        const cost = locked.outcome === 'received' ? receipt!.unitCost : locked.unitCost
        if (
          locked.previousPurchasePrice !== null &&
          cost !== null &&
          new Big(item.purchasePrice).eq(cost) &&
          !(await this.newerCost(trx, invoice, item, receipt))
        ) {
          item.purchasePrice = locked.previousPurchasePrice
        }

        if (locked.outcome === 'received') {
          await StockLedger.adjust(item, {
            quantity: new Big(receipt!.quantity).neg().toString(),
            reason: input.reason,
            occurredOn: DateTime.now(),
            reference: receipt!.reference,
            user: input.user,
            client: trx,
          })
        } else if (locked.setReceiptCost) {
          receipt!.unitCost = null
          await receipt!.save()
        }
        await this.takeBackSupplier(trx, item, invoice, locked)
        await item.save()
      }

      locked.merge({
        outcome: null,
        itemId: null,
        stockMovementId: null,
        unitCost: null,
        setReceiptCost: false,
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
   * The unit cost to record for `locked` (ConfirmedCost): Office's, or the
   * line's default amount over the quantity; null for a cost of zero
   * (free goods leave the purchase price as it is).
   */
  private static async confirmedCost(
    trx: TransactionClientContract,
    invoice: SupplierInvoice,
    locked: SupplierInvoiceLine,
    input: ConfirmedCost
  ) {
    if (input.unitCost !== undefined && input.unitCost !== null) {
      return new Big(input.unitCost).eq(0) ? null : input.unitCost
    }
    const lines = await SupplierInvoiceLine.query({ client: trx }).where(
      'supplierInvoiceId',
      invoice.id
    )
    const amount = this.defaultAmounts(invoice, lines).amounts.get(locked.id)!
    return receiptUnitCost(amount, input.quantity)
  }

  /**
   * Whether a receipt with a cost is newer than `receipt`, or, without
   * one, dated after the invoice: the purchase price then stays by
   * default.
   */
  private static async newerCost(
    trx: TransactionClientContract,
    invoice: SupplierInvoice,
    item: Item,
    receipt: StockMovement | null
  ) {
    if (receipt) return StockLedger.hasNewerCostedReceipt(receipt, trx)
    const newest = await StockLedger.newestCostDates([item.id], trx)
    return newerCostExists(newest.get(item.id) ?? null, invoice.issuedOn.toISODate()!)
  }

  /**
   * The receipt a line already received is linked to, locked: one of the
   * Item's, received by hand (not from a line) and linked to no line.
   */
  private static async linkableReceipt(
    trx: TransactionClientContract,
    receiptId: number,
    item: Item
  ) {
    const receipt = await StockMovement.query({ client: trx })
      .where('id', receiptId)
      .forUpdate()
      .first()
    const linked =
      receipt &&
      (await SupplierInvoiceLine.query({ client: trx })
        .where('stockMovementId', receipt.id)
        .first())
    if (
      !receipt ||
      linked ||
      receipt.kind !== 'receipt' ||
      receipt.itemId !== item.id ||
      receipt.supplierInvoiceLineId !== null
    ) {
      throw new LineRefusedError('receiptNotLinkable')
    }
    return receipt
  }

  /**
   * Gives the Item the invoice's Supplier when it has none, and the line's
   * article code as its supplier code when it has none and the Supplier is
   * this one. Changes `item`, for the caller to save; says whether the
   * code was set.
   */
  private static linkSupplier(item: Item, invoice: SupplierInvoice, line: SupplierInvoiceLine) {
    item.supplierId ??= invoice.supplierId
    const setSupplierCode =
      item.supplierCode === null && line.code !== null && item.supplierId === invoice.supplierId
    if (setSupplierCode) item.supplierCode = line.code
    return setSupplierCode
  }

  /** The Category's markup when the Item's resale price earns less than it */
  private static async belowMarkup(trx: TransactionClientContract, item: Item) {
    const category = item.categoryId ? await Category.find(item.categoryId, { client: trx }) : null
    const below =
      category && isBelowMarkup(item.purchasePrice, item.resalePrice, category.markupPercent)
    return below ? category.markupPercent : null
  }

  /**
   * Undoing `line`, received or already received onto the Item, from the
   * invoice's Supplier: once no other line of the Supplier is on the Item,
   * the Supplier link goes (only lines set it), and so does the supplier
   * code when this line set it and no other line of the Supplier with
   * that code is still on the Item. Changes `item`, for the caller to
   * save; the Item is locked, so its lines can't change meanwhile.
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
      .whereIn('l.outcome', ['received', 'already_received'])
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
   * Locks the invoice, the line and the Item, refusing a line already
   * handled or that can't be received, and an archived Item.
   */
  private static async lockToHandle(
    trx: TransactionClientContract,
    line: SupplierInvoiceLine,
    itemId: number
  ) {
    const { invoice, locked } = await this.lock(trx, line)
    if (locked.outcome !== null) throw new LineRefusedError('handled')
    const refusal = lineReceiptRefusal(invoice, locked)
    if (refusal) throw new LineRefusedError(refusal)
    const item = await Item.query({ client: trx }).where('id', itemId).forUpdate().firstOrFail()
    if (item.archivedAt) throw new LineRefusedError('archivedItem')
    return { invoice, locked, item }
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

/** Office's purchase price switch as StockLedger.receive's rule; left out, the newest decides */
function priceRule(update: boolean | undefined) {
  if (update === undefined) return 'ifNewest' as const
  return update ? ('set' as const) : ('keep' as const)
}
