import vine from '@vinejs/vine'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'
import { quantityRule } from '#validators/rules/quantity'

// Capped with the price so a line total fits numeric(14,2)
const LINE_QUANTITY_MAX = '99999'
const LINE_PRICE_MAX = '9999999'

export const newInvoiceValidator = vine.create({
  customerId: vine.number().exists({ table: 'customers', column: 'id' }),
})

/**
 * The whole draft as edited on the page: global discount, notes and the
 * ordered lines. Archived Items and VAT Codes can't be added, but lines
 * already on the draft keep theirs.
 */
export const invoiceValidator = vine
  .withMetaData<{ itemIds: number[]; vatCodeIds: number[] }>()
  .create({
    discountPercent: vine
      .string()
      .use(amountRule({ decimals: 2, max: '99.99' }))
      .optional(),
    notes: vine.string().trim().maxLength(5000).optional(),
    lines: vine
      .array(
        vine.object({
          itemId: vine
            .number()
            .exists({
              table: 'items',
              column: 'id',
              filter: (db, _, field) => {
                db.where((q) => q.whereNull('archived_at').orWhereIn('id', field.meta.itemIds))
              },
            })
            .optional(),
          description: vine.string().trim().minLength(1).maxLength(1000),
          quantity: vine
            .string()
            .use(quantityRule({ allowNegative: false, max: LINE_QUANTITY_MAX })),
          unitPrice: vine
            .string()
            .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: LINE_PRICE_MAX })),
          discountPercent: vine
            .string()
            .use(amountRule({ decimals: 2, max: '100' }))
            .optional(),
          vatCodeId: vine.number().exists({
            table: 'vat_codes',
            column: 'id',
            filter: (db, _, field) => {
              db.where((q) => q.whereNull('archived_at').orWhereIn('id', field.meta.vatCodeIds))
            },
          }),
        })
      )
      .maxLength(200),
  })
