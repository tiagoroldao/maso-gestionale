import vine from '@vinejs/vine'
import { QUOTE_LINE_KINDS } from '#models/quote_line'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'
import { quantityRule } from '#validators/rules/quantity'

const MAX = '9999999999'
const LINE_QUANTITY_MAX = '99999'
const LINE_PRICE_MAX = '9999999'

/**
 * The whole Quote as edited on the page: notes and the ordered lines.
 * Priced lines need a quantity and unit price; text lines only words.
 */
export const quoteValidator = vine
  .withMetaData<{ itemIds: number[]; labourRateIds: number[]; vatCodeIds: number[] }>()
  .create({
    notes: vine.string().trim().maxLength(5000).optional(),
    lines: vine
      .array(
        vine.object({
          kind: vine.enum(QUOTE_LINE_KINDS),
          itemId: vine
            .number()
            .exists({
              table: 'items',
              column: 'id',
              // Archived Items can't be added, but lines already on the Quote keep theirs
              filter: (db, _, field) => {
                db.where((q) => q.whereNull('archived_at').orWhereIn('id', field.meta.itemIds))
              },
            })
            .optional()
            .requiredWhen('kind', '=', 'item'),
          labourRateId: vine
            .number()
            .exists({
              table: 'labour_rates',
              column: 'id',
              filter: (db, _, field) => {
                db.where((q) =>
                  q.whereNull('archived_at').orWhereIn('id', field.meta.labourRateIds)
                )
              },
            })
            .optional()
            .requiredWhen('kind', '=', 'labour'),
          description: vine.string().trim().minLength(1).maxLength(1000),
          quantity: vine
            .string()
            // Capped with the price so a line total fits numeric(14,2)
            .use(quantityRule({ allowNegative: false, max: LINE_QUANTITY_MAX }))
            .optional()
            .requiredWhen('kind', '!=', 'text'),
          unitPrice: vine
            .string()
            .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: LINE_PRICE_MAX }))
            .optional()
            .requiredWhen('kind', '!=', 'text'),
          vatCodeId: vine
            .number()
            .exists({
              table: 'vat_codes',
              column: 'id',
              // Archived codes can't be picked, but lines already on the Quote keep theirs
              filter: (db, _, field) => {
                db.where((q) => q.whereNull('archived_at').orWhereIn('id', field.meta.vatCodeIds))
              },
            })
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
        db.whereNull('archived_at')
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
