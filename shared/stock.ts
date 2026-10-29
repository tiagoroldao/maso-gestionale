import Big from 'big.js'
import type { WorkState } from './charges.js'
import { takesNewWork, type JobStatus } from './jobs.js'
import { amountForInput } from './money.js'

/**
 * Stock quantities keep three decimals, as Stock Movements do.
 */
export const QUANTITY_DECIMALS = 3

/**
 * An Item's stock (ADR 0016): in stock (the sum of its Stock Movements),
 * committed (on planned Item Charges) and available (in stock less
 * committed), as decimal strings.
 */
export type StockQuantities = { inStock: string; committed: string; available: string }

/**
 * An Item Charge whose quantity counts as committed: its work state and
 * its Job's status.
 */
export type CommittingCharge = { quantity: string; work: WorkState; jobStatus: JobStatus }

/**
 * Whether an Item Charge commits its quantity: planned, on a Job that
 * takes new work. A closed or cancelled Job's planned Charges commit
 * nothing, since no one will use them, and a Charge done or not done
 * never does (the first has left stock, the second never will).
 */
export function isCommitted(work: WorkState, jobStatus: JobStatus) {
  return work === 'planned' && takesNewWork(jobStatus)
}

/**
 * In stock: the sum of the Item's Stock Movements. IN_STOCK_SQL says the
 * same in SQL.
 */
export function inStock(movements: { quantity: string }[]) {
  return movements
    .reduce((sum, movement) => sum.plus(movement.quantity), new Big(0))
    .toFixed(QUANTITY_DECIMALS)
}

/**
 * Committed: the quantity on the Item's Charges that commit it
 * (isCommitted()). COMMITTED_SQL says the same in SQL.
 */
export function committed(charges: CommittingCharge[]) {
  return charges
    .filter((charge) => isCommitted(charge.work, charge.jobStatus))
    .reduce((sum, charge) => sum.plus(charge.quantity), new Big(0))
    .toFixed(QUANTITY_DECIMALS)
}

/**
 * Available: in stock less committed, below zero when planned work needs
 * more than the Warehouse holds. AVAILABLE_SQL says the same in SQL.
 */
export function available(inStockQuantity: string, committedQuantity: string) {
  return new Big(inStockQuantity).minus(committedQuantity).toFixed(QUANTITY_DECIMALS)
}

/**
 * The three quantities from the Item's Stock Movements and Item Charges.
 */
export function stockQuantities(
  movements: { quantity: string }[],
  charges: CommittingCharge[]
): StockQuantities {
  const held = inStock(movements)
  const spokenFor = committed(charges)
  return { inStock: held, committed: spokenFor, available: available(held, spokenFor) }
}

/**
 * Why an Item needs reordering, by what is available: below zero
 * ('negative'), or at or below its reorder level ('low'); null when it
 * doesn't.
 */
export function reorderReason(availableQuantity: string, reorderLevel: string | null) {
  if (new Big(availableQuantity).lt(0)) return 'negative' as const
  if (reorderLevel !== null && new Big(availableQuantity).lte(reorderLevel)) return 'low' as const
  return null
}

/**
 * A quantity as people write it: "2.500" becomes "2,5", "3.000" becomes
 * "3".
 */
export function formatQuantity(quantity: string) {
  return amountForInput(quantity).replace(/,?0+$/, '').replace(/,$/, '')
}
