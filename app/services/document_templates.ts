import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import DocumentTemplate from '#models/document_template'
import DocumentTemplateVersion from '#models/document_template_version'
import type User from '#models/user'
import type { TemplateField, TemplateNode } from '#shared/document_templates'

export type TemplateInput = { name: string; body: TemplateNode; fields: TemplateField[] }

/**
 * An archived template is kept for the documents issued from it, and no
 * longer changed: restore it first.
 */
export class TemplateArchivedError extends Error {}

/**
 * Saving Document Templates: every save adds a version, numbered from 1,
 * so documents issued from an earlier one keep it as it was.
 */
export default class DocumentTemplates {
  static async create(input: TemplateInput, user: User | null = null) {
    return db.transaction(async (trx) => {
      const template = await DocumentTemplate.create({ name: input.name }, { client: trx })
      await this.addVersion(trx, template, 1, input, user)
      return template
    })
  }

  static async save(template: DocumentTemplate, input: TemplateInput, user: User | null = null) {
    return db.transaction(async (trx) => {
      // Locked, so two saves can't take the same version number
      const locked = await DocumentTemplate.query({ client: trx })
        .where('id', template.id)
        .forUpdate()
        .firstOrFail()
      if (locked.archivedAt) throw new TemplateArchivedError()
      locked.useTransaction(trx)
      locked.name = input.name
      await locked.save()
      const latest = await DocumentTemplateVersion.query({ client: trx })
        .where('documentTemplateId', locked.id)
        .max('version as latest')
        .first()
      return this.addVersion(trx, locked, Number(latest?.$extras.latest ?? 0) + 1, input, user)
    })
  }

  /**
   * The template's current version: its latest.
   */
  static current(template: DocumentTemplate) {
    return DocumentTemplateVersion.query()
      .where('documentTemplateId', template.id)
      .orderBy('version', 'desc')
      .firstOrFail()
  }

  private static addVersion(
    trx: TransactionClientContract,
    template: DocumentTemplate,
    version: number,
    input: TemplateInput,
    user: User | null
  ) {
    return DocumentTemplateVersion.create(
      {
        documentTemplateId: template.id,
        version,
        name: input.name,
        body: input.body,
        fields: input.fields,
        createdBy: user?.id ?? null,
      },
      { client: trx }
    )
  }
}
