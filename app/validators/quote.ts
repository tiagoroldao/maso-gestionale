import vine from '@vinejs/vine'
import { QUOTE_LINE_KINDS } from '#models/quote_line'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'
import { quantityRule } from '#validators/rules/quantity'

const MAX = '9999999999'

/**
 * The whole Quote as edited on the page: notes and the ordered lines.
 * Priced lines need a quantity and unit price; text lines only words.
 */
export const quoteValidator = vine.create({
  notes: vine.string().trim().maxLength(5000).optional(),
  lines: vine
    .array(
      vine.object({
        kind: vine.enum(QUOTE_LINE_KINDS),
        itemId: vine
          .number()
          .exists({ table: 'items', column: 'id' })
          .optional()
          .requiredWhen('kind', '=', 'item'),
        labourRateId: vine
          .number()
          .exists({ table: 'labour_rates', column: 'id' })
          .optional()
          .requiredWhen('kind', '=', 'labour'),
        description: vine.string().trim().minLength(1).maxLength(1000),
        quantity: vine
          .string()
          .use(quantityRule({ allowNegative: false }))
          .optional()
          .requiredWhen('kind', '!=', 'text'),
        unitPrice: vine
          .string()
          .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: MAX }))
          .optional()
          .requiredWhen('kind', '!=', 'text'),
      })
    )
    .maxLength(200),
})

export const labourRateValidator = vine.withMetaData<{ id?: number }>().create({
  name: vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(100)
    .unique({
      table: 'labour_rates',
      column: 'name',
      caseInsensitive: true,
      filter: (db, _, field) => {
        if (field.meta.id) db.whereNot('id', field.meta.id)
      },
    }),
  hourlyPrice: vine.string().use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: MAX })),
})

export const callOutFeeValidator = vine.create({
  callOutFee: vine
    .string()
    .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: MAX }))
    .optional(),
})
