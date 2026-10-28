import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { INVOICE_STAGES, SUBMISSION_OUTCOMES } from '#shared/invoice_lifecycle'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'
import { quantityRule } from '#validators/rules/quantity'

/**
 * An Item is never sold at a negative price; only deduction lines are.
 */
const noNegativeItemPrice = vine.createRule((value: unknown, _, field: FieldContext) => {
  if (typeof value === 'string' && value.startsWith('-') && field.parent.itemId) {
    field.report('The {{ field }} field must be a valid amount', 'amount', field)
  }
})

// Capped with the price so a line total fits numeric(14,2)
const LINE_QUANTITY_MAX = '99999'
const LINE_PRICE_MAX = '9999999'

export const newInvoiceValidator = vine.create({
  customerId: vine.number().exists({
    table: 'customers',
    column: 'id',
    filter: (db) => {
      db.whereNull('archived_at')
    },
  }),
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
          unit: vine.string().trim().maxLength(10).optional(),
          quantity: vine
            .string()
            .use(quantityRule({ allowNegative: false, max: LINE_QUANTITY_MAX })),
          // Negative only on a line without an Item: a deduction (Advance Invoices)
          unitPrice: vine
            .string()
            .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: LINE_PRICE_MAX, signed: true }))
            .use(noNegativeItemPrice()),
          discountPercent: vine
            .string()
            .use(amountRule({ decimals: 2, max: '100' }))
            .optional(),
          deductsInvoiceId: vine.number().withoutDecimals().optional(),
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

export const invoiceNumberingValidator = vine.create({
  nextNumber: vine.number().withoutDecimals().min(1).max(999999),
})

export const invoiceStageValidator = vine.create({
  stage: vine.enum(INVOICE_STAGES).optional(),
})

export const submissionOutcomeValidator = vine.create({
  outcome: vine.enum(SUBMISSION_OUTCOMES),
  // The notice's date; today when left out
  noticeOn: vine
    .date({ formats: ['YYYY-MM-DD'] })
    .beforeOrEqual('today')
    .optional(),
  // SDI's identifier for the file, shown on its notices
  sdiId: vine
    .string()
    .trim()
    .regex(/^\d{1,20}$/)
    .optional(),
  // SDI's notice: error codes and description for a Rejection
  notes: vine.string().trim().maxLength(5000).optional(),
})

export const sdiPrefixValidator = vine.create({
  sdiFilePrefix: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]$/),
})

export const paymentValidator = vine.create({
  amount: vine.string().use(amountRule({ decimals: 2, max: '9999999999', positive: true })),
  paidOn: vine.date({ formats: ['YYYY-MM-DD'] }).beforeOrEqual('today'),
  note: vine.string().trim().maxLength(255).optional(),
})
