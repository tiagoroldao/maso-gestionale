import vine from '@vinejs/vine'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'
import { quantityRule } from '#validators/rules/quantity'

const occurredOn = () => vine.date({ formats: ['YYYY-MM-DD'] }).beforeOrEqual('today')

export const receiptValidator = vine.create({
  quantity: vine.string().use(quantityRule({ allowNegative: false })),
  unitCost: vine
    .string()
    .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: '9999999999' }))
    .optional(),
  occurredOn: occurredOn(),
  reference: vine.string().trim().maxLength(255).optional(),
})

export const adjustmentValidator = vine.create({
  quantity: vine.string().use(quantityRule({ allowNegative: true })),
  reason: vine.string().trim().minLength(1).maxLength(1000),
  occurredOn: occurredOn(),
})
