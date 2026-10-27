import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { parseAmount } from '#shared/money'

type Options = { decimals: number; max: string }

/**
 * A non-negative decimal amount typed with a comma or a dot ("12,50"),
 * stored as a fixed-decimal string ("12.5000") (ADR 0007).
 */
export const amountRule = vine.createRule(
  (value: unknown, options: Options, field: FieldContext) => {
    if (typeof value !== 'string' && typeof value !== 'number') return

    const amount = parseAmount(String(value))
    // More decimals than are stored would be rounded without anyone noticing
    const decimals = String(value).trim().split(/[.,]/)[1]?.length ?? 0
    if (!amount || amount.lt(0) || amount.gt(options.max) || decimals > options.decimals) {
      field.report('The {{ field }} field must be a valid amount', 'amount', field)
      return
    }
    field.mutate(amount.toFixed(options.decimals), field)
  }
)
