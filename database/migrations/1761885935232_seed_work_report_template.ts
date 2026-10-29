import { BaseSchema } from '@adonisjs/lucid/schema'

const NAME = 'Rapportino di lavoro'

const placeholder = (key: string, label: string) => ({ type: 'placeholder', attrs: { key, label } })
const text = (value: string) => ({ type: 'text', text: value })

/**
 * The work report (#180) as a Document Template every Instance starts
 * with: a Job and its work report field, printed as the Job, the period
 * and the day-by-day table. The Admin can change it like any other, or
 * archive it. Skipped when a template already has the name.
 */
const FIELDS = [
  { key: 'commessa', label: 'Commessa', type: 'job', required: true },
  { key: 'rapportino', label: 'Rapportino', type: 'work_report', required: true },
]
const BODY = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [text('Commessa: '), placeholder('field.commessa', 'Commessa')],
    },
    {
      type: 'paragraph',
      content: [text('Periodo: '), placeholder('field.rapportino', 'Rapportino')],
    },
    { type: 'fieldTable', attrs: { key: 'rapportino', label: 'Rapportino' } },
  ],
}

export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      const [template] = await db
        .table('document_templates')
        .insert({ name: NAME, created_at: new Date() })
        .onConflict('name')
        .ignore()
        .returning('id')
      if (!template) return
      await db.table('document_template_versions').insert({
        document_template_id: template.id,
        version: 1,
        name: NAME,
        body: JSON.stringify(BODY),
        fields: JSON.stringify(FIELDS),
        created_at: new Date(),
      })
    })
  }

  /**
   * Removes the seeded template while nothing was issued from it or saved
   * over it; otherwise it stays, as any template in use does.
   */
  async down() {
    this.defer(async (db) => {
      const template = await db
        .from('document_templates')
        .where('name', NAME)
        .whereNotExists((query) =>
          query.from('issued_documents').whereRaw('document_template_id = document_templates.id')
        )
        .whereNotExists((query) =>
          query
            .from('document_template_versions')
            .whereRaw('document_template_id = document_templates.id')
            .where('version', '>', 1)
        )
        .first()
      if (!template) return
      // Versions are frozen by a trigger: lifted for this delete only
      await db.rawQuery(
        'ALTER TABLE document_template_versions DISABLE TRIGGER document_template_versions_frozen'
      )
      await db
        .from('document_template_versions')
        .where('document_template_id', template.id)
        .delete()
      await db.rawQuery(
        'ALTER TABLE document_template_versions ENABLE TRIGGER document_template_versions_frozen'
      )
      await db.from('document_templates').where('id', template.id).delete()
    })
  }
}
