import vine from '@vinejs/vine'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'

const price = () =>
  vine.string().use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: '9999999999' }))

/**
 * Validator for creating and editing an Item. The resale price is always
 * the value the person entered; the Category markup only pre-fills it.
 */
export const itemValidator = vine.withMetaData<{ id?: number }>().create({
  code: vine
    .string()
    .trim()
    .toUpperCase()
    .minLength(1)
    .maxLength(50)
    .unique({
      table: 'items',
      column: 'code',
      caseInsensitive: true,
      filter: (db, _, field) => {
        if (field.meta.id) db.whereNot('id', field.meta.id)
      },
    }),
  description: vine.string().trim().minLength(1).maxLength(1000),
  unit: vine.string().trim().minLength(1).maxLength(10),
  categoryId: vine.number().exists({ table: 'categories', column: 'id' }).optional(),
  supplierName: vine.string().trim().maxLength(255).optional(),
  supplierCode: vine.string().trim().maxLength(100).optional(),
  vatRate: vine.string().use(amountRule({ decimals: 2, max: '100' })),
  purchasePrice: price(),
  resalePrice: price(),
})

export const itemSearchValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
  page: vine.number().min(1).optional(),
})

/**
 * Validator for the Admin's Categories.
 */
export const categoryValidator = vine.withMetaData<{ id?: number }>().create({
  name: vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(100)
    .unique({
      table: 'categories',
      column: 'name',
      caseInsensitive: true,
      filter: (db, _, field) => {
        if (field.meta.id) db.whereNot('id', field.meta.id)
      },
    }),
  markupPercent: vine.string().use(amountRule({ decimals: 2, max: '1000' })),
})
