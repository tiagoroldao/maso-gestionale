import Big from 'big.js'
import { sumAmounts } from './money.js'

/**
 * A Charge as drafting an Invoice reads it: what decides whether it
 * shares a line with others (ADR 0017).
 */
export type CombinableCharge = {
  kind: 'labour' | 'item' | 'other'
  labourRateId: number | null
  itemId: number | null
  // The Item's Groupable flag (#176); ignored for hours and other costs
  groupable: boolean
  unitPrice: string
  // The VAT Code the line will carry
  vatCodeId: number
  billQuantity: string
}

/**
 * A draft line: the Charges it bills, in order, and its quantity (theirs
 * added up). Its price is theirs, shared.
 */
export type CombinedLine<T> = { charges: T[]; quantity: string }

/**
 * The lines a draft Invoice starts with, from the Charges in the order
 * their work happened (ADR 0017). Without `combine`, one line per
 * Charge, in that order. With it, alike Charges share a line: hours of the
 * same Labour Rate, or a Groupable Item, at the same billed price and VAT
 * Code. Any other Charge gets a line of its own: an Item that isn't
 * Groupable (Equipment, significant goods), so a unit can be credited
 * alone and named by its serial number, and Office's other costs. Lines of
 * the same Labour Rate or Item sit together (at different prices, or a
 * line per piece), where the first of them happened.
 *
 * Applied to the Charges of one section of the draft (ADR 0018,
 * organiseCharges()).
 */
export function combineCharges<T extends CombinableCharge>(
  charges: T[],
  { combine }: { combine: boolean }
): CombinedLine<T>[] {
  if (!combine)
    return charges.map((charge) => ({ charges: [charge], quantity: charge.billQuantity }))

  // The Labour Rate or Item first, then the line within it
  const clusters = new Map<string, Map<string, T[]>>()
  charges.forEach((charge, index) => {
    const cluster =
      charge.kind === 'labour'
        ? `labour:${charge.labourRateId}`
        : charge.kind === 'item'
          ? `item:${charge.itemId}`
          : `other:${index}`
    const combines = charge.kind === 'labour' || (charge.kind === 'item' && charge.groupable)
    const line = combines
      ? `${new Big(charge.unitPrice).toFixed()}|${charge.vatCodeId}`
      : `single:${index}`
    if (!clusters.has(cluster)) clusters.set(cluster, new Map())
    const lines = clusters.get(cluster)!
    if (!lines.has(line)) lines.set(line, [])
    lines.get(line)!.push(charge)
  })
  return [...clusters.values()].flatMap((lines) =>
    [...lines.values()].map((group) => ({
      charges: group,
      quantity: group.reduce((sum, charge) => sum.plus(charge.billQuantity), new Big(0)).toFixed(3),
    }))
  )
}

/**
 * The days a combined line's work happened on, for its description: how
 * many Visits, and the first and last of their days (ISO dates). Charges
 * on the Job itself have no Visit and don't count.
 */
export function workPeriod(charges: { visitId: number | null; day: string | null }[]) {
  const visits = new Set(charges.flatMap((charge) => (charge.visitId ? [charge.visitId] : [])))
  const days = charges.flatMap((charge) => (charge.day ? [charge.day] : [])).sort()
  return days.length ? { visits: visits.size, from: days[0], to: days[days.length - 1] } : null
}

/**
 * A draft line as "fold consumables" reads it.
 */
export type FoldableLine = {
  // A line billing an Item that is Groupable (#176)
  groupable: boolean
  // Lines fold together only with the same VAT treatment and kind
  vatKey: string
  // Its amount, or null while it is incomplete
  amount: string | null
}

/**
 * "Fold consumables" on a draft (ADR 0017): every line of a Groupable Item
 * folds into one lump line per VAT treatment, for its lines' total. Each
 * fold gives the positions of its lines (the first one becomes the lump)
 * and the total. A treatment with an incomplete line isn't folded.
 */
export function consumableFolds(lines: FoldableLine[]) {
  const folds = new Map<string, number[]>()
  lines.forEach((line, index) => {
    if (!line.groupable) return
    if (!folds.has(line.vatKey)) folds.set(line.vatKey, [])
    folds.get(line.vatKey)!.push(index)
  })
  return [...folds.values()].flatMap((indices) => {
    const amounts = indices.map((index) => lines[index].amount)
    if (amounts.some((amount) => amount === null)) return []
    return [{ indices, amount: sumAmounts(amounts as string[]) }]
  })
}
