import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { parseAmount } from '#shared/money'
import { NATURA_CODES } from '#shared/vat'
import { amountRule } from '#validators/rules/amount'

const chargesVat = (field: FieldContext) => !parseAmount(String(field.parent.rate ?? ''))?.eq(0)

/**
 * A Natura code explains why no VAT is charged, so it only goes with 0%.
 */
const onlyWithoutVat = vine.createRule((_: unknown, __: undefined, field: FieldContext) => {
  if (chargesVat(field)) field.report('Natura only applies at 0%', 'natura.withRate', field)
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
    .requiredWhen((field) => !chargesVat(field)),
  legalNote: vine.string().trim().maxLength(500).optional(),
})
