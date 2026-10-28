import { hasMany, scope } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DocumentTemplateSchema } from '#database/schema'
import DocumentTemplateVersion from '#models/document_template_version'

/**
 * A document the Admin designs (a compliance certificate, a declaration),
 * filled in and issued for a Customer. Its content is in versions; the
 * latest is the current one.
 */
export default class DocumentTemplate extends DocumentTemplateSchema {
  static table = 'document_templates'

  @hasMany(() => DocumentTemplateVersion)
  declare versions: HasMany<typeof DocumentTemplateVersion>

  static active = scope((query) => {
    query.whereNull('archived_at')
  })
}
