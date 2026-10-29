import app from '@adonisjs/core/services/app'
import type { I18n } from '@adonisjs/i18n'
import type { FieldContext, MessagesProviderContact } from '@vinejs/vine/types'

const PREFIX = 'validator.shared'

/**
 * Validation messages from the catalogue (`validator.shared`). Under test a
 * message, or a field name it shows, missing from the catalogue throws:
 * otherwise VineJS falls back to its English message or the raw field name,
 * and a test comparing against the catalogue can't tell (#207).
 */
export function validationMessages(i18n: I18n): MessagesProviderContact {
  const provider = i18n.createMessagesProvider(PREFIX)
  if (!app.inTest) return provider

  return {
    getMessage(defaultMessage, rule, field: FieldContext, meta?: Record<string, any>) {
      const resolved =
        i18n.resolveIdentifier(`${PREFIX}.messages.${field.wildCardPath}.${rule}`) ??
        i18n.resolveIdentifier(`${PREFIX}.messages.${rule}`)
      if (!resolved) {
        throw new Error(`Missing validation message: ${field.wildCardPath}.${rule}`)
      }
      const shown = { field: field.name, otherField: meta?.otherField }
      for (const [placeholder, name] of Object.entries(shown)) {
        if (
          name !== undefined &&
          resolved.message.includes(`{${placeholder}}`) &&
          !i18n.hasMessage(`${PREFIX}.fields.${name}`)
        ) {
          throw new Error(`Missing validation field name: ${name}`)
        }
      }
      // A copy: the provider translates `otherField` in place, and VineJS
      // hands the same object to every report of the rule
      return provider.getMessage(defaultMessage, rule, field, meta && { ...meta })
    },
  }
}
