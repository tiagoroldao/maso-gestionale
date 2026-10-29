import app from '@adonisjs/core/services/app'
import type { I18n } from '@adonisjs/i18n'
import type { FieldContext, MessagesProviderContact } from '@vinejs/vine/types'

const PREFIX = 'validator.shared'

/**
 * Validation messages from the catalogue (`validator.shared`).
 *
 * A message shows under its own field, so it never names it (#226): only
 * `{otherField}`, the other field a rule compares with (`sameAs`), is
 * named, by its label in `validator.shared.fields`. Pages that show an
 * error away from its field put the field's label beside it.
 *
 * The provider gets a copy of the rule's options: it translates
 * `otherField` in place, and VineJS builds those options once per
 * validator, so after one refusal `sameAs` would compare against the
 * Italian label and refuse every later submission.
 *
 * Under test a message missing from the catalogue, one naming its own
 * field, or another field's name missing from it, throws: otherwise VineJS
 * falls back to its English message or the raw field name, and a test
 * comparing against the catalogue can't tell (#207).
 */
export function validationMessages(
  i18n: I18n,
  { strict = app.inTest }: { strict?: boolean } = {}
): MessagesProviderContact {
  const provider = i18n.createMessagesProvider(PREFIX)

  return {
    getMessage(defaultMessage, rule, field: FieldContext, meta?: Record<string, any>) {
      if (strict) assertInCatalogue(i18n, rule, field, meta)
      return provider.getMessage(defaultMessage, rule, field, meta && { ...meta })
    },
  }
}

function assertInCatalogue(
  i18n: I18n,
  rule: string,
  field: FieldContext,
  meta?: Record<string, any>
) {
  const resolved =
    i18n.resolveIdentifier(`${PREFIX}.messages.${field.wildCardPath}.${rule}`) ??
    i18n.resolveIdentifier(`${PREFIX}.messages.${rule}`)
  if (!resolved) {
    throw new Error(`Missing validation message: ${field.wildCardPath}.${rule}`)
  }
  if (resolved.message.includes('{field}')) {
    throw new Error(`Validation message names its own field: ${field.wildCardPath}.${rule}`)
  }
  const otherField = meta?.otherField
  if (
    otherField !== undefined &&
    resolved.message.includes('{otherField}') &&
    !i18n.hasMessage(`${PREFIX}.fields.${otherField}`)
  ) {
    throw new Error(`Missing validation field name: ${otherField}`)
  }
}
