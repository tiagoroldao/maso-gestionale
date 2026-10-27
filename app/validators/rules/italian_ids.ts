import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { isValidItalianIban, isValidTaxCode, isValidVatNumber } from '#fiscal/italian_ids'

/**
 * Builds a rule that strips spaces, upper-cases the value and checks it,
 * so "it60 x054…" is accepted and stored as "IT60X054…".
 */
function normalizedRule(check: (value: string) => boolean, message: string, ruleName: string) {
  return vine.createRule((value: unknown, _: undefined, field: FieldContext) => {
    if (typeof value !== 'string') return

    const normalized = value.replace(/\s+/g, '').toUpperCase()
    if (!check(normalized)) {
      field.report(message, ruleName, field)
      return
    }
    field.mutate(normalized, field)
  })
}

export const vatNumberRule = normalizedRule(
  isValidVatNumber,
  'The {{ field }} field must be a valid Partita IVA',
  'vatNumber'
)

export const taxCodeRule = normalizedRule(
  isValidTaxCode,
  'The {{ field }} field must be a valid Codice Fiscale',
  'taxCode'
)

export const italianIbanRule = normalizedRule(
  isValidItalianIban,
  'The {{ field }} field must be a valid Italian IBAN',
  'italianIban'
)
