import vine from '@vinejs/vine'
import { TAX_REGIMES, type TaxRegime } from '#fiscal/tax_regimes'
import { italianIbanRule, taxCodeRule, vatNumberRule } from '#validators/rules/italian_ids'

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

  iban: vine.string().use(italianIbanRule()).optional(),
  email: vine.string().trim().email().maxLength(254).optional(),
  phone: vine.string().trim().maxLength(32).optional(),

  logo: vine.file({ size: '2mb', extnames: ['png', 'jpg', 'jpeg', 'webp'] }).optional(),
  removeLogo: vine.boolean().optional(),
})
