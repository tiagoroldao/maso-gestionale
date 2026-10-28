import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DocumentTemplateVersionSchema } from '#database/schema'
import DocumentTemplate from '#models/document_template'
import type { TemplateField, TemplateNode } from '#shared/document_templates'

/**
 * One saved state of a Document Template: its body and fields. Never
 * changed once written (a database trigger refuses it).
 */
export default class DocumentTemplateVersion extends DocumentTemplateVersionSchema {
  static table = 'document_template_versions'

  @column({ prepare: (value: TemplateNode) => JSON.stringify(value) })
  declare body: TemplateNode

  // An array would otherwise be sent as a Postgres array, not JSON
  @column({ prepare: (value: TemplateField[]) => JSON.stringify(value) })
  declare fields: TemplateField[]

  @belongsTo(() => DocumentTemplate, { foreignKey: 'documentTemplateId' })
  declare template: BelongsTo<typeof DocumentTemplate>
}
