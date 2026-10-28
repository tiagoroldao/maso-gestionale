import vine from '@vinejs/vine'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'
import { quantityRule } from '#validators/rules/quantity'

const quantity = () => vine.string().use(quantityRule({ allowNegative: false, max: '99999' }))

/**
 * Correcting recorded hours: the Labour Rate and who worked them (a
 * Technician, or a name for someone outside the app). An archived choice
 * is refused unless already on the Charge (Charges service).
 */
export const labourCorrectionValidator = vine.create({
  quantity: quantity(),
  labourRateId: vine.number().exists({ table: 'labour_rates', column: 'id' }),
  technicianId: vine
    .number()
    .exists({
      table: 'users',
      column: 'id',
      filter: (db) => {
        db.where('role', 'technician')
      },
    })
    .optional(),
  workerName: vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(100)
    .optional()
    .requiredIfMissing('technicianId'),
})

/**
 * Correcting an Item used (see labourCorrectionValidator on archived).
 */
export const itemCorrectionValidator = vine.create({
  quantity: quantity(),
  itemId: vine.number().exists({ table: 'items', column: 'id' }),
})

/**
 * What a Charge bills: quantity, unit price and the Invoice line's text.
 */
export const chargeBillingValidator = vine.create({
  quantity: quantity(),
  unitPrice: vine.string().use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: '9999999999' })),
  description: vine.string().trim().minLength(1).maxLength(255),
})
