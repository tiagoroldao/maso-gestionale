import Big from 'big.js'
import { splitAmount } from './money.js'

/**
 * Advance Invoices and their deductions (ADR 0011): any Job Invoice takes
 * back part or all of an issued advance, an amount VAT included that
 * Office sets. Used by the server and the Office pages alike.
 */

/**
 * How much of an advance issued Invoices have taken back.
 */
export const ADVANCE_STATES = ['not_deducted', 'partly_deducted', 'fully_deducted'] as const
export type AdvanceState = (typeof ADVANCE_STATES)[number]

export function advanceState(total: string, deducted: string): AdvanceState {
  if (new Big(deducted).lte(0)) return 'not_deducted'
  return new Big(deducted).gte(total) ? 'fully_deducted' : 'partly_deducted'
}

/**
 * What is left to take back of an advance, VAT included.
 */
export function advanceLeft(total: string, deducted: string) {
  const left = new Big(total).minus(deducted)
  return (left.lt(0) ? new Big(0) : left).toFixed(2)
}

export type AdvanceRow = { vatRate: string; natura: string | null; taxable: string; vat: string }

const rowKey = (row: { vatRate: string; natura: string | null }) =>
  `${new Big(row.vatRate).toFixed(2)}|${row.natura ?? ''}`

/**
 * The taxable amount to take back from each of the advance's VAT rows for
 * `amount` (VAT included): split over the rows in proportion to their
 * totals, each row's VAT taken out at its rate. Taking back all that is
 * `left` takes back exactly each row's taxable not yet taken back
 * (`taken`, by row, from issued Invoices), so the advance always closes
 * to the cent. A part never takes back more than its row has left, so
 * rounding can't overshoot and leave the closing step a positive line.
 */
export function deductionRows(
  rows: AdvanceRow[],
  amount: string,
  left: string,
  taken: { vatRate: string; natura: string | null; taxable: string }[] = []
) {
  const billed = rows.filter((row) => !new Big(row.taxable).eq(0))
  const remaining = billed.map((row) =>
    taken
      .filter((other) => rowKey(other) === rowKey(row))
      .reduce((rest, other) => rest.minus(other.taxable), new Big(row.taxable))
  )
  if (new Big(amount).eq(left)) {
    return billed.map((row, index) => ({ ...row, taxable: remaining[index].toFixed(2) }))
  }
  const totals = billed.map((row) => new Big(row.taxable).plus(row.vat).toFixed(2))
  const parts = splitAmount(amount, totals)
  return billed.map((row, index) => {
    const part = new Big(parts[index])
      .times(row.taxable)
      .div(totals[index])
      .round(2, Big.roundHalfUp)
    const capped = part.gt(remaining[index]) ? remaining[index] : part
    return { ...row, taxable: capped.toFixed(2) }
  })
}
