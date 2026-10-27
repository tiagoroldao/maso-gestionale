import vine from '@vinejs/vine'

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
