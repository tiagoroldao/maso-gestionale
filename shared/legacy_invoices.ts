import Big from 'big.js'

/**
 * Legacy Invoices (#27): invoices the previous accounting software issued,
 * kept as their totals and the original PDF, outside the SDI flow. An
 * advance (ADR 0011) also gives its VAT rows, so later Invoices can build
 * their deduction lines. Used by the server and the Office pages alike.
 */

/** One VAT row of a Legacy advance: its VAT treatment and taxable amount */
export type LegacyVatRowInput = { vatRate: string; natura: string | null; taxable: string }

/**
 * The VAT of a row, worked out at its rate and rounded half-up to the
 * cent, as invoiceTotals() does for an Invoice's VAT summary.
 */
export function legacyRowVat(row: { vatRate: string; taxable: string }) {
  return new Big(row.taxable).times(row.vatRate).div(100).round(2, Big.roundHalfUp).toFixed(2)
}

/**
 * Why a Legacy Invoice's amounts can't be recorded:
 * - `advanceWithoutJob`: an advance is taken back by its Job's Invoices;
 * - `noVatRows`: an advance needs its VAT rows to be taken back;
 * - `duplicateVatRow`: two rows with the same rate and Natura (the PDF's
 *   summary has one row for each);
 * - `rowsTaxable`, `rowsVat`: the rows don't add up to the taxable amount,
 *   or their VAT (worked out per row) to the VAT, as printed;
 * - `advanceTotal`: an advance's total isn't its taxable plus VAT, so
 *   taking all of it back wouldn't close it to the cent.
 * A Legacy Invoice that isn't an advance keeps its totals as printed
 * (a stamp duty, for one, can make the total more than taxable plus VAT).
 */
export type LegacyAmountsRefusal =
  'advanceWithoutJob' | 'noVatRows' | 'duplicateVatRow' | 'rowsTaxable' | 'rowsVat' | 'advanceTotal'

export function legacyAmountsRefusal(input: {
  jobId: number | null
  advance: boolean
  taxable: string
  vat: string
  total: string
  vatRows: LegacyVatRowInput[]
}): LegacyAmountsRefusal | null {
  if (!input.advance) return null
  if (!input.jobId) return 'advanceWithoutJob'
  if (!input.vatRows.length) return 'noVatRows'
  const keys = input.vatRows.map((row) => `${new Big(row.vatRate).toFixed(2)}|${row.natura ?? ''}`)
  if (new Set(keys).size !== keys.length) return 'duplicateVatRow'
  const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Big(0))
  if (!sum(input.vatRows.map((row) => row.taxable)).eq(input.taxable)) return 'rowsTaxable'
  if (!sum(input.vatRows.map(legacyRowVat)).eq(input.vat)) return 'rowsVat'
  if (!new Big(input.taxable).plus(input.vat).eq(input.total)) return 'advanceTotal'
  return null
}
