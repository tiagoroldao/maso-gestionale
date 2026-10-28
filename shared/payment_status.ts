import Big from 'big.js'

export const PAYMENT_STATUSES = ['unpaid', 'partly_paid', 'paid', 'overpaid', 'overdue'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/**
 * What is still owed on an Invoice: its total less its Payments, refunds
 * counting negative (ADR 0014). Below zero when the Invoice is overpaid.
 * The one place it is worked out (OWED_SQL in SQL), so Credit Notes
 * (#145) come off it here.
 */
export function owed(input: { total: string; paid: string }) {
  return new Big(input.total).minus(input.paid).toFixed(2)
}

/**
 * Settled: nothing is owed, and the Invoice isn't overpaid either.
 */
export function isSettled(input: { total: string; paid: string }) {
  return new Big(owed(input)).eq(0)
}

/**
 * How much an overpaid Invoice was overpaid by; null when it isn't.
 */
export function overpaidBy(input: { total: string; paid: string }) {
  const left = new Big(owed(input))
  return left.lt(0) ? left.abs().toFixed(2) : null
}

/**
 * An Invoice's payment status, worked out from what was paid and when it
 * is due (never set by hand): overpaid when what is owed is below zero,
 * paid when it is zero; otherwise overdue after the due date, partly paid
 * or unpaid before it.
 */
export function paymentStatus(input: {
  total: string
  paid: string
  dueOn: string
  today: string
}): PaymentStatus {
  const left = new Big(owed(input))
  if (left.lt(0)) return 'overpaid'
  if (left.eq(0)) return 'paid'
  if (input.dueOn < input.today) return 'overdue'
  return new Big(input.paid).gt(0) ? 'partly_paid' : 'unpaid'
}
