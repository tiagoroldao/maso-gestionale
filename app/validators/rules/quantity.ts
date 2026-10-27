import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { parseQuantity } from '#shared/money'

type Options = { allowNegative: boolean }

/**
 * A non-zero quantity typed with a comma or a dot ("2,5" metres), stored
 * with 3 decimals. Negative only where `allowNegative` (adjustments).
 */
export const quantityRule = vine.createRule(
  (value: unknown, options: Options, field: FieldContext) => {
    if (typeof value !== 'string' && typeof value !== 'number') return

    const quantity = parseQuantity(String(value))
    const valid =
      quantity &&
      !quantity.eq(0) &&
      quantity.abs().lt('100000000000') &&
      (options.allowNegative || quantity.gt(0))
    if (!valid) {
      field.report('The {{ field }} field must be a valid quantity', 'quantity', field)
      return
    }
    field.mutate(quantity.toFixed(3), field)
  }
)
