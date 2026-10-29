/**
 * Supplier Invoices (#198): received from suppliers, uploaded by Office or
 * delivered by the SDI intermediary (#92), and dealt with in an inbox,
 * their lines received into stock or marked not stock (#199), or already
 * received by hand (#210).
 */
import Big from 'big.js'
import { UNIT_PRICE_DECIMALS, splitAmount } from './money.js'

/**
 * An inbox entry is to handle until every line has an outcome
 * (LINE_OUTCOMES), then handled; undoing a line's outcome sets it back.
 */
export const SUPPLIER_INVOICE_STATUSES = ['to_handle', 'handled'] as const
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number]

/** How it arrived: uploaded by Office, or through the SDI intermediary */
export const SUPPLIER_INVOICE_SOURCES = ['upload', 'sdi'] as const
export type SupplierInvoiceSource = (typeof SUPPLIER_INVOICE_SOURCES)[number]

/**
 * Legal archiving through the SDI intermediary (#214, ADR 0019), per
 * file: queued to go, being sent, requested (the intermediary took it) or
 * failed (retried by the poller, or from the invoice's page). Null when
 * never asked for.
 */
export const LEGAL_ARCHIVING_STATES = ['queued', 'sending', 'requested', 'failed'] as const
export type LegalArchivingState = (typeof LEGAL_ARCHIVING_STATES)[number]

/** The states a file waits to be sent in: by the poller, or by Office from its page */
export const ARCHIVING_WAITING_STATES: readonly LegalArchivingState[] = ['queued', 'failed']

export function isArchivingWaiting(state: LegalArchivingState | null) {
  return state !== null && ARCHIVING_WAITING_STATES.includes(state)
}

/**
 * FatturaPA document types (TipoDocumento) with a label in the catalogue
 * (`ui.supplierInvoices.documentTypes`); others are shown as their code.
 */
export const DOCUMENT_TYPES = [
  'TD01',
  'TD02',
  'TD03',
  'TD04',
  'TD05',
  'TD06',
  'TD16',
  'TD17',
  'TD18',
  'TD19',
  'TD20',
  'TD21',
  'TD22',
  'TD23',
  'TD24',
  'TD25',
  'TD26',
  'TD27',
  'TD28',
  'TD29',
] as const

/**
 * FatturaPA payment methods (ModalitaPagamento), all of them: a supplier
 * may use any (`ui.supplierInvoices.paymentMethods`).
 */
export const ALL_PAYMENT_METHODS = Array.from(
  { length: 23 },
  (_, index) => `MP${String(index + 1).padStart(2, '0')}`
)

/**
 * What a Supplier Invoice's page shows beyond its header and lines, as
 * read from the file: the seller and buyer as written, the VAT summary,
 * the payments due and the notes (Causale).
 */
export type SupplierInvoiceDetails = {
  version: 'FPR12' | 'FPA12'
  seller: {
    name: string
    vatCountry: string
    vatNumber: string
    taxCode: string | null
    address: {
      street: string
      streetNumber: string | null
      postalCode: string
      city: string
      province: string | null
      country: string
    } | null
  }
  buyer: { name: string; vatNumber: string | null; taxCode: string | null }
  summary: {
    vatRate: string
    natura: string | null
    taxable: string
    vat: string
    reference: string | null
  }[]
  payments: { method: string; dueOn: string | null; amount: string; iban: string | null }[]
  notes: string[]
  /** The delivery notes the invoice cites (DatiDDT), #210 */
  deliveryNotes: { number: string; date: string }[]
  /**
   * Discounts (SC) and surcharges (MG) on the whole document
   * (ScontoMaggiorazione in DatiGeneraliDocumento), #210
   */
  discounts: { type: 'SC' | 'MG'; percent: string | null; amount: string | null }[]
}

/**
 * What became of a Supplier Invoice line: received into stock onto an
 * Item (#199); already received by hand onto an Item, so stock doesn't
 * move, optionally linked to that earlier receipt (#210); or marked not
 * stock (shipping, services, untracked consumables). A line with none is
 * still to handle; the invoice is handled once none is.
 */
export const LINE_OUTCOMES = ['received', 'already_received', 'not_stock'] as const
export type LineOutcome = (typeof LINE_OUTCOMES)[number]

/**
 * Why a line can't be received into stock, only marked not stock: it is
 * on a credit note (TD04: goods going back, not coming in), in another
 * currency than euro (ADR 0007: purchase prices are in euro), or its
 * amount is negative (a discount or a return).
 */
export type LineReceiptRefusal = 'creditNote' | 'currency' | 'negativeTotal'

/** Why the line can't be received (LineReceiptRefusal), or null when it can */
export function lineReceiptRefusal(
  invoice: { documentType: string; currency: string },
  line: { total: string }
): LineReceiptRefusal | null {
  if (invoice.documentType === 'TD04') return 'creditNote'
  if (invoice.currency !== 'EUR') return 'currency'
  if (new Big(line.total).lt(0)) return 'negativeTotal'
  return null
}

/**
 * The unit cost of a line received as `quantity` of the Item's unit: the
 * line's amount (PrezzoTotale, after the supplier's discounts) divided by
 * the quantity received, half-up to unit-price precision. Null for a line
 * of zero (free goods), which leaves the purchase price as it is.
 */
export function receiptUnitCost(lineTotal: string, quantity: string) {
  const total = new Big(lineTotal)
  if (total.eq(0)) return null
  return total
    .div(quantity)
    .round(UNIT_PRICE_DECIMALS, Big.roundHalfUp)
    .toFixed(UNIT_PRICE_DECIMALS)
}

/**
 * The discount on the whole invoice, to spread over its lines (#210), as
 * a 2-decimal amount taken off (negative when surcharges outweigh it):
 * its negative lines (a discount or rebate written as a line), plus each
 * document-level discount (SC) less each surcharge (MG), by its amount,
 * or else by its percentage of the lines' total, half-up to the cent.
 */
export function invoiceDiscount(
  discounts: SupplierInvoiceDetails['discounts'],
  lines: { total: string }[]
) {
  const linesTotal = lines.reduce((sum, line) => sum.plus(line.total), new Big(0))
  let discount = lines.reduce(
    (sum, line) => (new Big(line.total).lt(0) ? sum.minus(line.total) : sum),
    new Big(0)
  )
  for (const entry of discounts) {
    const amount =
      entry.amount !== null
        ? new Big(entry.amount)
        : linesTotal.times(entry.percent!).div(100).round(2, Big.roundHalfUp)
    discount = entry.type === 'SC' ? discount.plus(amount) : discount.minus(amount)
  }
  return discount.round(2, Big.roundHalfUp).toFixed(2)
}

/**
 * The amount each line is received at by default (#210): its own amount
 * (PrezzoTotale, after its own discounts), less its part of the
 * invoice's discount (invoiceDiscount()) when `spread` is on.
 *
 * The discount is split over the lines that can still be received or
 * already are: positive, not refused (lineReceiptRefusal()) and not
 * marked not stock. Each part is in proportion to the line's amount,
 * rounded to the cent, and the parts add up to the discount exactly: the
 * cents lost to rounding go to the largest remainders (splitAmount()).
 * Nothing is spread (`spreadable` false) when no line can take it, or
 * when it is more than those lines' total (a cost below zero).
 */
export function defaultLineAmounts(
  invoice: { documentType: string; currency: string; spread: boolean },
  discounts: SupplierInvoiceDetails['discounts'],
  lines: { id: number; total: string; outcome: LineOutcome | null }[]
) {
  const discount = invoiceDiscount(discounts, lines)
  const pool = lines.filter(
    (line) =>
      line.outcome !== 'not_stock' &&
      new Big(line.total).gt(0) &&
      lineReceiptRefusal(invoice, line) === null
  )
  const poolTotal = pool.reduce((sum, line) => sum.plus(line.total), new Big(0))
  const spreadable = pool.length > 0 && poolTotal.gte(discount)
  const amounts = new Map(lines.map((line) => [line.id, new Big(line.total).toString()]))
  if (invoice.spread && spreadable && !new Big(discount).eq(0)) {
    const parts = splitAmount(
      discount,
      pool.map((line) => line.total)
    )
    pool.forEach((line, index) => {
      amounts.set(line.id, new Big(line.total).minus(parts[index]).toString())
    })
  }
  return { discount, spreadable, amounts }
}

/**
 * Whether an Item has a receipt with a cost dated after `on` (its newest,
 * `newestCostOn`, as ISO dates): then a cost recorded on `on` isn't the
 * newest, and the purchase price switch starts off (#210).
 */
export function newerCostExists(newestCostOn: string | null, on: string) {
  return newestCostOn !== null && newestCostOn > on
}

/**
 * Units of measure written differently for the same thing: what suppliers
 * write (UnitaMisura) next to what Items use.
 */
const UNIT_ALIASES: Record<string, string> = {
  n: 'pz',
  nr: 'pz',
  num: 'pz',
  pezzo: 'pz',
  pezzi: 'pz',
  pc: 'pz',
  pcs: 'pz',
  mt: 'm',
  metro: 'm',
  metri: 'm',
  lt: 'l',
  litro: 'l',
  litri: 'l',
}

function unitKey(unit: string) {
  const key = unit.toLowerCase().replace(/[\s.]/g, '')
  return UNIT_ALIASES[key] ?? key
}

/**
 * Whether a line's unit of measure differs from the Item's ("CF" against
 * "pz"), ignoring case, dots and common spellings ("PZ", "nr." and "pz"
 * agree). A line without a unit never differs. When they differ, Office
 * gives the quantity received in the Item's unit.
 */
export function unitsDiffer(lineUnit: string | null, itemUnit: string) {
  if (lineUnit === null || !lineUnit.trim()) return false
  return unitKey(lineUnit) !== unitKey(itemUnit)
}

/**
 * A description as compared when suggesting an Item: spaces collapsed,
 * lower case. DESCRIPTION_KEY_SQL (app/services/supplier_invoice_lines.ts)
 * says the same in SQL.
 */
export function descriptionKey(description: string) {
  return description.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * A FatturaPA document type (TipoDocumento) by name, or its code when the
 * catalogue doesn't name it; `t` is the server's or the pages' translator.
 */
export function documentTypeLabel(code: string, t: (key: string) => string) {
  return (DOCUMENT_TYPES as readonly string[]).includes(code)
    ? t(`ui.supplierInvoices.documentTypes.${code}`)
    : code
}

/** A payment method (ModalitaPagamento) by name, or its code */
export function paymentMethodLabel(code: string, t: (key: string) => string) {
  return ALL_PAYMENT_METHODS.includes(code)
    ? `${t(`ui.supplierInvoices.paymentMethods.${code}`)} (${code})`
    : code
}

/**
 * An amount in the invoice's currency, Italian style; unit prices keep up
 * to the 8 decimals FatturaPA allows.
 */
export function formatAmount(amount: string, currency: string, maxDecimals = 2) {
  try {
    return new Intl.NumberFormat('it', {
      style: 'currency',
      currency,
      useGrouping: 'always',
      minimumFractionDigits: 2,
      maximumFractionDigits: maxDecimals,
    }).format(amount as unknown as number)
  } catch {
    // Not a currency code Intl knows
    return `${amount} ${currency}`
  }
}
