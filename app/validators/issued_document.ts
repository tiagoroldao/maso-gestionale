import vine from '@vinejs/vine'

/**
 * A replacement: the original's template filled for a Customer, a value
 * per field key, which TemplateData checks against each field.
 */
export const replacementValidator = vine.create({
  customerId: vine.number().nullable().optional(),
  values: vine.record(vine.any().nullable()).optional(),
})

/**
 * An Issued Document: a template filled for a Customer.
 */
export const issuedDocumentValidator = vine.create({
  templateId: vine.number(),
  customerId: vine.number().nullable().optional(),
  values: vine.record(vine.any().nullable()).optional(),
})
