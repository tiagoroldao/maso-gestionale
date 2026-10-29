import { belongsTo, column, hasOne, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasOne } from '@adonisjs/lucid/types/relations'
import { IssuedDocumentSchema } from '#database/schema'
import Customer from '#models/customer'
import DocumentTemplate from '#models/document_template'
import DocumentTemplateVersion from '#models/document_template_version'
import type { CompanyDetails, Recipient } from '#documents/document_renderer'
import type { TableData } from '#shared/document_templates'

const json = { prepare: (value: unknown) => JSON.stringify(value) }

/**
 * A numbered, frozen document produced from a Document Template for one
 * Customer (#31). It prints only what it copied when issued, so later
 * edits to a Site, an Item, the Customer or the template never change it.
 * Never changed once written (a database trigger refuses it), except for
 * `replacedById`, set once when a replacement is issued, and `pdfPath`,
 * set once when its PDF is first rendered and stored.
 */
export default class IssuedDocument extends IssuedDocumentSchema {
  static table = 'issued_documents'

  @column(json)
  declare recipient: Recipient

  @column(json)
  declare company: CompanyDetails

  // The printed placeholders, by key
  @column(json)
  declare values: Record<string, string>

  @column(json)
  declare tables: Record<string, TableData>

  // The fields as filled in, by key: prefills a replacement
  @column(json)
  declare input: Record<string, unknown>

  /**
   * Documents a Technician may open from a Visit: not a Job's work report
   * (#180), which can print prices. Read from the version it was issued
   * with, which never changes.
   */
  static forTechnicians = scope((query) => {
    query.whereNotExists((versions) =>
      versions
        .from('document_template_versions as v')
        .whereRaw('v.id = issued_documents.document_template_version_id')
        .whereRaw(`v.fields @> '[{"type": "work_report"}]'::jsonb`)
    )
  })

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @belongsTo(() => DocumentTemplate, { foreignKey: 'documentTemplateId' })
  declare template: BelongsTo<typeof DocumentTemplate>

  @belongsTo(() => DocumentTemplateVersion, { foreignKey: 'documentTemplateVersionId' })
  declare version: BelongsTo<typeof DocumentTemplateVersion>

  // The original this one replaces
  @hasOne(() => IssuedDocument, { foreignKey: 'replacedById' })
  declare replaces: HasOne<typeof IssuedDocument>

  @belongsTo(() => IssuedDocument, { foreignKey: 'replacedById' })
  declare replacedBy: BelongsTo<typeof IssuedDocument>

  /**
   * The number people quote: "2026/0007", counted per template and year.
   */
  get number() {
    return `${this.year}/${String(this.sequence).padStart(4, '0')}`
  }
}
