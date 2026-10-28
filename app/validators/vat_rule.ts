import vine from '@vinejs/vine'

/**
 * The default VAT rules as edited: each rule's new code, which must be an
 * active VAT Code (an archived one already on a rule may stay).
 */
export const vatRulesValidator = vine.create({
  rules: vine
    .array(
      vine.object({
        id: vine.number().exists({ table: 'vat_rules', column: 'id' }),
        vatCodeId: vine.number().exists({
          table: 'vat_codes',
          column: 'id',
          filter: (query, _, field) => {
            query.where((q) =>
              q
                .whereNull('archived_at')
                .orWhereIn('id', (sub) =>
                  sub.from('vat_rules').select('vat_code_id').where('id', field.parent.id)
                )
            )
          },
        }),
      })
    )
    .minLength(1),
})
