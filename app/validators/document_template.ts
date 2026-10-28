import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import {
  FIELD_KEY_PATTERN,
  FIELD_TYPES,
  MAX_TABLE_COLUMNS,
  TABLE_COLUMN_SOURCES,
  TABLE_COLUMN_TYPES,
  isValidTemplateBody,
  placeholderKeys,
  tableKeys,
} from '#shared/document_templates'

/**
 * The body must be a TipTap document of allowed nodes, whose placeholders
 * are built-in or among the template's fields, and whose tables are its
 * table fields.
 */
const templateBody = vine.createRule((value: unknown, _, field: FieldContext) => {
  const fields = Array.isArray(field.parent.fields) ? field.parent.fields : []
  if (!isValidTemplateBody(value, placeholderKeys(fields), tableKeys(fields))) {
    field.report('The {{ field }} field is not a valid template', 'templateBody', field)
  }
})

/**
 * A document has one Site and one Job, which other fields depend on: at
 * most one field of each, and Installed Equipment only with a Site field
 * to choose it from. Reported on the field that breaks the rule.
 */
const entityFieldRules = vine.createRule((value: unknown, _, field: FieldContext) => {
  const fields: unknown[] = Array.isArray(field.data?.fields) ? field.data.fields : []
  const types = fields.map((other) => (other as { type?: unknown } | null)?.type)
  const position = fields.indexOf(field.parent)
  if ((value === 'site' || value === 'job') && types.indexOf(value) < position) {
    field.report(`Only one ${value} field is allowed`, `templateFields.one.${value}`, field)
  }
  if (value === 'equipment' && !types.includes('site')) {
    field.report('Equipment needs a site field', 'templateFields.equipmentNeedsSite', field)
  }
})

const templateFields = () =>
  vine
    .array(
      vine.object({
        key: vine.string().regex(FIELD_KEY_PATTERN),
        label: vine.string().trim().minLength(1).maxLength(100),
        type: vine.enum(FIELD_TYPES).use(entityFieldRules()),
        required: vine.boolean(),
        options: vine
          .array(vine.string().trim().minLength(1).maxLength(100))
          .minLength(1)
          .distinct()
          .optional()
          .requiredWhen('type', '=', 'choice'),
        columns: vine
          .array(
            vine.object({
              key: vine.string().regex(FIELD_KEY_PATTERN),
              label: vine.string().trim().minLength(1).maxLength(100),
              type: vine.enum(TABLE_COLUMN_TYPES),
              from: vine.enum(TABLE_COLUMN_SOURCES).optional(),
            })
          )
          .minLength(1)
          .maxLength(MAX_TABLE_COLUMNS)
          .distinct('key')
          .optional()
          .requiredWhen('type', '=', 'table'),
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
 * A template filled for a Customer: a value per field key, which
 * TemplateData checks against each field (empty texts arrive as null).
 */
export const documentTemplateFillValidator = vine.create({
  customerId: vine.number().nullable().optional(),
  values: vine.record(vine.any().nullable()).optional(),
})

/**
 * The editor's unsaved state, for the live preview.
 */
export const documentTemplatePreviewValidator = vine.create({
  name: vine.string().trim().maxLength(150).optional(),
  fields: templateFields(),
  body: vine.any().use(templateBody()),
})
