import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import {
  FIELD_KEY_PATTERN,
  FIELD_TYPES,
  isValidTemplateBody,
  placeholderKeys,
} from '#shared/document_templates'

/**
 * The body must be a TipTap document of allowed nodes, whose placeholders
 * are built-in or among the template's fields.
 */
const templateBody = vine.createRule((value: unknown, _, field: FieldContext) => {
  const fields = Array.isArray(field.parent.fields) ? field.parent.fields : []
  if (!isValidTemplateBody(value, placeholderKeys(fields))) {
    field.report('The {{ field }} field is not a valid template', 'templateBody', field)
  }
})

const templateFields = () =>
  vine
    .array(
      vine.object({
        key: vine.string().regex(FIELD_KEY_PATTERN),
        label: vine.string().trim().minLength(1).maxLength(100),
        type: vine.enum(FIELD_TYPES),
        required: vine.boolean(),
        options: vine
          .array(vine.string().trim().minLength(1).maxLength(100))
          .minLength(1)
          .distinct()
          .optional()
          .requiredWhen('type', '=', 'choice'),
      })
    )
    .maxLength(50)
    .distinct('key')

/**
 * A Document Template as the Admin saves it: each save is a new version.
 */
export const documentTemplateValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(150),
  fields: templateFields(),
  body: vine.any().use(templateBody()),
})

/**
 * The editor's unsaved state, for the live preview.
 */
export const documentTemplatePreviewValidator = vine.create({
  name: vine.string().trim().maxLength(150).optional(),
  fields: templateFields(),
  body: vine.any().use(templateBody()),
})
