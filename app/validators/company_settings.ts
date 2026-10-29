import vine from '@vinejs/vine'
import { TAX_REGIMES, type TaxRegime } from '#fiscal/tax_regimes'
import { italianIbanRule, taxCodeRule, vatNumberRule } from '#validators/rules/italian_ids'
import { amountRule } from '#validators/rules/amount'
import { fatturaEmail } from '#validators/rules/email'
import { LIQUIDATION_STATUSES, SOLE_SHAREHOLDER } from '#shared/company'

/**
 * Validator for the Admin saving the company settings. The fields that
 * appear on every invoice are required; contact details are optional.
 * Lengths follow the FatturaPA limits (Denominazione 80, Indirizzo and
 * Comune 60).
 */
export const companySettingsValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(80),
  vatNumber: vine.string().use(vatNumberRule()),
  taxCode: vine.string().use(taxCodeRule()),
  taxRegime: vine.enum(Object.keys(TAX_REGIMES) as TaxRegime[]),

  street: vine.string().trim().minLength(1).maxLength(60),
  streetNumber: vine.string().trim().maxLength(8).optional(),
  postalCode: vine
    .string()
    .trim()
    .regex(/^\d{5}$/),
  city: vine.string().trim().minLength(1).maxLength(60),
  province: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),

  // Registro Imprese: office and number go together; the rest is optional
  reaOffice: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .requiredIfExists('reaNumber'),
  reaNumber: vine.string().trim().maxLength(20).optional().requiredIfExists('reaOffice'),
  shareCapital: vine
    .string()
    .use(amountRule({ decimals: 2, max: '99999999999.99' }))
    .optional(),
  soleShareholder: vine.enum(SOLE_SHAREHOLDER).optional(),
  liquidationStatus: vine.enum(LIQUIDATION_STATUSES).optional(),

  iban: vine.string().use(italianIbanRule()).optional(),
  email: fatturaEmail().optional(),
  phone: vine.string().trim().maxLength(32).optional(),

  logo: vine.file({ size: '2mb', extnames: ['png', 'jpg', 'jpeg', 'webp'] }).optional(),
  removeLogo: vine.boolean().optional(),
})
