import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { parseAmount } from '#shared/money'
import { NATURA_CODES } from '#shared/vat'
import { amountRule } from '#validators/rules/amount'

const rateOf = (field: FieldContext) => parseAmount(String(field.parent.rate ?? ''))

/**
 * A Natura code explains why no VAT is charged, so it only goes with 0%.
 * An invalid rate is reported on the rate alone.
 */
const onlyWithoutVat = vine.createRule((_: unknown, __: undefined, field: FieldContext) => {
  const rate = rateOf(field)
  if (rate && !rate.eq(0)) field.report('Natura only applies at 0%', 'natura.withRate', field)
})

export const vatCodeValidator = vine.withMetaData<{ id?: number }>().create({
  name: vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(100)
    .unique({
      table: 'vat_codes',
      column: 'name',
      caseInsensitive: true,
      filter: (db, _, field) => {
        db.whereNull('archived_at')
        if (field.meta.id) db.whereNot('id', field.meta.id)
      },
    }),
  rate: vine.string().use(amountRule({ decimals: 2, max: '99.99' })),
  natura: vine
    .enum(NATURA_CODES)
    .use(onlyWithoutVat())
    .optional()
    .requiredWhen((field) => Boolean(rateOf(field)?.eq(0))),
  legalNote: vine.string().trim().maxLength(500).optional(),
})
