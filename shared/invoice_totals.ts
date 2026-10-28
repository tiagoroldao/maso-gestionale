import Big from 'big.js'

/**
 * What the totals need from a line: amounts as decimal strings (ADR 0007)
 * and the VAT treatment copied from its VAT Code.
 */
export type TotalsLine = {
  quantity: string
  unitPrice: string
  /** Line discount, in percent */
  discountPercent?: string
  vatRate: string
  natura: string | null
  /** Takes back an Advance Invoice: the global discount never applies */
  deduction?: boolean
}

/**
 * One row of the VAT summary (FatturaPA DatiRiepilogo): lines sharing a
 * rate and Natura, the share of the global discount they carry, and the
 * VAT on what remains.
 */
export type VatSummaryRow = {
  vatRate: string
  natura: string | null
  linesTotal: string
  discount: string
  taxable: string
  vat: string
}

export type InvoiceTotals = {
  linesTotal: string
  discount: string
  taxable: string
  vat: string
  total: string
  summary: VatSummaryRow[]
}

const cents = (value: Big) => value.round(2, Big.roundHalfUp)

/**
 * A line's amount: quantity × unit price, less its discount, rounded
 * half-up to the cent. FatturaPA checks PrezzoTotale the same way.
 */
export function invoiceLineTotal(quantity: string, unitPrice: string, discountPercent = '0') {
  const gross = new Big(quantity).times(unitPrice)
  return cents(gross.times(new Big(100).minus(discountPercent)).div(100)).toFixed(2)
}

/**
 * Splits `amount` (in cents) across `weights` in proportion, so the parts
 * add up exactly. Weights may be negative (a deduction line's VAT row):
 * each part is first rounded toward zero, then the cents left go, in the
 * direction they're missing, to the parts whose exact share is furthest
 * that way (ties to the first).
 */
function splitProportionally(amount: Big, weights: Big[]) {
  const sum = weights.reduce((acc, weight) => acc.plus(weight), new Big(0))
  if (sum.eq(0)) return weights.map(() => new Big(0))
  const exact = weights.map((weight) => amount.times(weight).div(sum))
  const parts = exact.map((value) => value.round(2, Big.roundDown))
  let left = amount.minus(parts.reduce((acc, part) => acc.plus(part), new Big(0)))
  const step = new Big(left.lt(0) ? '-0.01' : '0.01')
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value.minus(parts[index]).times(step.s) }))
    .sort((a, b) => b.remainder.cmp(a.remainder) || a.index - b.index)
  for (const { index } of byRemainder) {
    if (left.eq(0)) break
    parts[index] = parts[index].plus(step)
    left = left.minus(step)
  }
  return parts
}

/**
 * The Invoice's totals and VAT summary. The global discount percentage is
 * applied to the total before VAT of the lines billing work (deduction
 * lines excluded) and split across the summary rows in proportion to
 * those amounts; VAT is then worked out per row, rounded half-up to the
 * cent.
 */
export function invoiceTotals(lines: TotalsLine[], discountPercent = '0'): InvoiceTotals {
  type Group = { vatRate: string; natura: string | null; amount: Big; discountable: Big }
  const groups = new Map<string, Group>()
  for (const line of lines) {
    const vatRate = new Big(line.vatRate).toFixed(2)
    const key = `${vatRate}|${line.natura ?? ''}`
    const group = groups.get(key) ?? {
      vatRate,
      natura: line.natura,
      amount: new Big(0),
      discountable: new Big(0),
    }
    const amount = new Big(invoiceLineTotal(line.quantity, line.unitPrice, line.discountPercent))
    group.amount = group.amount.plus(amount)
    if (!line.deduction) group.discountable = group.discountable.plus(amount)
    groups.set(key, group)
  }

  // Highest rate first, then by Natura, as invoices usually list them
  const rows = [...groups.values()].sort(
    (a, b) => new Big(b.vatRate).cmp(a.vatRate) || (a.natura ?? '').localeCompare(b.natura ?? '')
  )
  const linesTotal = rows.reduce((sum, row) => sum.plus(row.amount), new Big(0))
  // On the work billed; deductions never carry the global discount
  const discountable = rows.reduce((sum, row) => sum.plus(row.discountable), new Big(0))
  const discount = cents(discountable.times(discountPercent).div(100))
  const shares = splitProportionally(
    discount,
    rows.map((row) => row.discountable)
  )

  const summary = rows.map((row, index) => {
    const taxable = row.amount.minus(shares[index])
    return {
      vatRate: row.vatRate,
      natura: row.natura,
      linesTotal: row.amount.toFixed(2),
      discount: shares[index].toFixed(2),
      taxable: taxable.toFixed(2),
      vat: cents(taxable.times(row.vatRate).div(100)).toFixed(2),
    }
  })
  const taxable = linesTotal.minus(discount)
  const vat = summary.reduce((sum, row) => sum.plus(row.vat), new Big(0))

  return {
    linesTotal: linesTotal.toFixed(2),
    discount: discount.toFixed(2),
    taxable: taxable.toFixed(2),
    vat: vat.toFixed(2),
    total: taxable.plus(vat).toFixed(2),
    summary,
  }
}
