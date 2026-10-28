import vine from '@vinejs/vine'

const optionalText = (max: number) => vine.string().trim().maxLength(max).optional()

/**
 * Validator for creating and editing a Site. When created from a
 * Customer's page, `customerId` links the new Site to that Customer.
 */
export const siteValidator = vine.create({
  label: optionalText(255),
  street: vine.string().trim().minLength(1).maxLength(255),
  streetNumber: optionalText(8),
  unit: optionalText(64),
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
  accessNotes: optionalText(5000),
  // A checkbox: absent when unticked
  residential: vine.boolean().optional(),
  customerId: vine.number().exists({ table: 'customers', column: 'id' }).optional(),
})

export const siteSearchValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
  page: vine.number().min(1).optional(),
  customerId: vine.number().optional(),
  archived: vine.boolean().optional(),
})

export const linkSiteValidator = vine.create({
  siteId: vine.number().exists({
    table: 'sites',
    column: 'id',
    filter: (db) => {
      db.whereNull('archived_at')
    },
  }),
})
