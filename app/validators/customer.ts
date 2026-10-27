import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { CUSTOMER_TYPES } from '#models/customer'
import { taxCodeRule, vatNumberRule } from '#validators/rules/italian_ids'

/**
 * A private individual's Codice Fiscale is the 16-character personal
 * code; a condominium's is the 11-digit numeric code.
 */
const taxCodeMatchesType = vine.createRule((value: unknown, _: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  const type = field.parent.type
  if (type === 'private' && value.length !== 16) {
    field.report('A private individual needs a 16-character Codice Fiscale', 'taxCodeType', field)
  }
  if (type === 'condominium' && value.length !== 11) {
    field.report('A condominium needs an 11-digit Codice Fiscale', 'taxCodeType', field)
  }
})

const optionalText = (max: number) => vine.string().trim().maxLength(max).optional()

/**
 * Validator for creating and editing a Customer. Which name and tax
 * fields are required depends on the type.
 */
export const customerValidator = vine.create({
  type: vine.enum(CUSTOMER_TYPES),

  firstName: optionalText(255).requiredWhen('type', '=', 'private'),
  lastName: optionalText(255).requiredWhen('type', '=', 'private'),
  name: optionalText(255).requiredWhen('type', 'in', ['company', 'condominium']),

  vatNumber: vine.string().use(vatNumberRule()).optional().requiredWhen('type', '=', 'company'),
  taxCode: vine
    .string()
    .use(taxCodeRule())
    .use(taxCodeMatchesType())
    .optional()
    .requiredWhen('type', 'in', ['private', 'condominium']),
  sdiCode: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{7}$/)
    .optional(),
  pec: vine.string().trim().email().maxLength(254).optional(),

  street: vine.string().trim().minLength(1).maxLength(255),
  streetNumber: optionalText(8),
  postalCode: vine
    .string()
    .trim()
    .regex(/^\d{5}$/),
  city: vine.string().trim().minLength(1).maxLength(255),
  province: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),

  email: vine.string().trim().email().maxLength(254).optional(),
  phone: optionalText(32),
  notes: optionalText(5000),

  paymentTermsId: vine.number().exists({ table: 'payment_terms', column: 'id' }),
})

export const customerSearchValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
  page: vine.number().min(1).optional(),
})

/**
 * Validator for the Admin's Payment Terms.
 */
export const paymentTermsValidator = vine.withMetaData<{ id?: number }>().create({
  name: vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(100)
    .unique({
      table: 'payment_terms',
      column: 'name',
      caseInsensitive: true,
      filter: (db, _, field) => {
        if (field.meta.id) db.whereNot('id', field.meta.id)
      },
    }),
  days: vine.number().withoutDecimals().min(0).max(365),
  endOfMonth: vine.boolean().optional(),
})
