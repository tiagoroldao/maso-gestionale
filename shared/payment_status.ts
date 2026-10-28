import Big from 'big.js'

export const PAYMENT_STATUSES = ['unpaid', 'partly_paid', 'paid', 'overdue'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/**
 * An Invoice's payment status, worked out from what was paid and when it
 * is due (never set by hand): paid once the total is covered; otherwise
 * overdue after the due date, partly paid or unpaid before it.
 */
export function paymentStatus(input: {
  total: string
  paid: string
  dueOn: string
  today: string
}): PaymentStatus {
  const owed = new Big(input.total).minus(input.paid)
  if (owed.lte(0)) return 'paid'
  if (input.dueOn < input.today) return 'overdue'
  return new Big(input.paid).gt(0) ? 'partly_paid' : 'unpaid'
}

/**
 * What is still owed on an Invoice, never below zero.
 */
export function outstanding(total: string, paid: string) {
  const left = new Big(total).minus(paid)
  return (left.lt(0) ? new Big(0) : left).toFixed(2)
}
