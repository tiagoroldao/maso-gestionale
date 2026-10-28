import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { parseAmount } from '#shared/money'

type Options = {
  decimals: number
  max: string
  positive?: boolean
  signed?: boolean
  nonZero?: boolean
}

/**
 * A decimal amount typed with a comma or a dot ("12,50"), stored as a
 * fixed-decimal string ("12.5000") (ADR 0007): non-negative, above zero
 * with `positive`, or of either sign within ±max with `signed` (and not
 * zero with `nonZero`).
 */
export const amountRule = vine.createRule(
  (value: unknown, options: Options, field: FieldContext) => {
    if (typeof value !== 'string' && typeof value !== 'number') return

    const amount = parseAmount(String(value))
    // More decimals than are stored would be rounded without anyone noticing
    const decimals = (String(value).trim().split(/[.,]/)[1] ?? '').replace(/0+$/, '').length
    const outOfRange = options.signed
      ? amount?.abs().gt(options.max)
      : amount?.lt(0) || amount?.gt(options.max)
    if (!amount || outOfRange || decimals > options.decimals) {
      field.report('The {{ field }} field must be a valid amount', 'amount', field)
      return
    }
    if (options.positive && amount.eq(0)) {
      field.report('The {{ field }} field must be above zero', 'amount.positive', field)
      return
    }
    if (options.nonZero && amount.eq(0)) {
      field.report('The {{ field }} field must not be zero', 'amount.nonZero', field)
      return
    }
    field.mutate(amount.toFixed(options.decimals), field)
  }
)
