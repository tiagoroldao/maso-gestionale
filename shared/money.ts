/**
 * Money and other decimal amounts (ADR 0007). Amounts are never JS
 * floats: they travel as strings ("12.5000"), are stored as Postgres
 * numeric and are calculated with big.js. Used by the server and the
 * Vue pages alike.
 */
import Big from 'big.js'

/**
 * Decimals kept for unit prices (FatturaPA allows up to 8; parts never
 * need more than 4).
 */
export const UNIT_PRICE_DECIMALS = 4

/**
 * Parses an amount typed by a person: "12,50", "12.50" or "1234". Thousands
 * separators are not accepted, so "1.234,56" is rejected rather than
 * misread. Returns null for anything that isn't a plain decimal.
 */
export function parseAmount(input: string): Big | null {
  const normalized = input.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  return new Big(normalized)
}

/**
 * The resale price suggested by a Category markup, e.g. 10.00 at 35% is
 * 13.50. Rounded half-up to cents: it is only a suggestion the person
 * then edits.
 */
export function suggestedResalePrice(purchasePrice: string, markup: string) {
  return new Big(purchasePrice)
    .times(new Big(markup).div(100).plus(1))
    .round(2, Big.roundHalfUp)
    .toFixed(2)
}

/**
 * The margin of a resale price over a purchase price, as a percentage of
 * the purchase price, or null when the purchase price is zero.
 */
export function markupPercent(purchasePrice: string, resalePrice: string) {
  const purchase = new Big(purchasePrice)
  if (purchase.eq(0)) return null
  return new Big(resalePrice).minus(purchase).div(purchase).times(100).round(2).toFixed(2)
}

/**
 * A stored amount as a person would type it back: "12.5000" becomes
 * "12,50" and "0.1250" becomes "0,125". At least two decimals, no
 * trailing zeros beyond them.
 */
export function amountForInput(amount: string) {
  const [whole, fraction = ''] = new Big(amount).toFixed(UNIT_PRICE_DECIMALS).split('.')
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0')
  return `${whole},${trimmed}`
}
