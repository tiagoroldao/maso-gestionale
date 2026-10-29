import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Issued Documents (#31): a Document Template filled for one Customer,
 * numbered per template and year, with everything it prints copied in.
 * Never changed or deleted; a mistake is put right by a replacement.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('issued_documents', (table) => {
      table.increments('id').notNullable()
      table
        .integer('document_template_id')
        .notNullable()
        .references('id')
        .inTable('document_templates')
        .onDelete('RESTRICT')
      // The version it was filled from: its body is printed with `values`
      table
        .integer('document_template_version_id')
        .notNullable()
        .references('id')
        .inTable('document_template_versions')
        .onDelete('RESTRICT')
      table.integer('year').notNullable()
      table.integer('sequence').notNullable()
      table.date('issued_on').notNullable()
      table
        .integer('customer_id')
        .notNullable()
        .references('id')
        .inTable('customers')
        .onDelete('RESTRICT')
      // The records chosen in its fields, for the history lists only: what
      // it prints is in `values`
      table.integer('site_id').nullable().references('id').inTable('sites').onDelete('RESTRICT')
      table
        .integer('installed_equipment_id')
        .nullable()
        .references('id')
        .inTable('installed_equipment')
        .onDelete('RESTRICT')
      table.integer('job_id').nullable().references('id').inTable('jobs').onDelete('RESTRICT')
      // The frozen copy: the Recipient, the company letterhead, the printed
      // values and tables, and the input as filled in (to prefill a
      // replacement)
      table.jsonb('recipient').notNullable()
      table.jsonb('company').notNullable()
      table.jsonb('values').notNullable()
      table.jsonb('tables').notNullable()
      table.jsonb('input').notNullable()
      // Set once, when a replacement is issued; the only change allowed
      table
        .integer('replaced_by_id')
        .nullable()
        .unique()
        .references('id')
        .inTable('issued_documents')
        .onDelete('RESTRICT')
      // The PDF as first rendered, in storage: served from then on, so a
      // later change to the Base Layout, the logo or the renderer never
      // changes it. Set once, like replaced_by_id
      table.string('pdf_path', 255).nullable()
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('RESTRICT')
      table.timestamp('created_at').notNullable()
      table.unique(['document_template_id', 'year', 'sequence'])
      table.check('sequence > 0', [], 'issued_documents_sequence_check')
      // A replacement is always issued after its original
      table.check(
        'replaced_by_id IS NULL OR replaced_by_id > id',
        [],
        'issued_documents_replaced_by_check'
      )
      table.index(['customer_id'])
      table.index(['site_id'])
      table.index(['installed_equipment_id'])
    })

    // Frozen: no delete or truncate, and no update except setting
    // replaced_by_id and pdf_path, each once (from NULL), with every other
    // column unchanged
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION issued_documents_frozen() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE'
          AND (NEW.replaced_by_id IS NOT DISTINCT FROM OLD.replaced_by_id
            OR (OLD.replaced_by_id IS NULL AND NEW.replaced_by_id IS NOT NULL))
          AND (NEW.pdf_path IS NOT DISTINCT FROM OLD.pdf_path
            OR (OLD.pdf_path IS NULL AND NEW.pdf_path IS NOT NULL))
          AND to_jsonb(NEW) - 'replaced_by_id' - 'pdf_path'
            = to_jsonb(OLD) - 'replaced_by_id' - 'pdf_path'
        THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Issued Documents can not be changed';
      END;
      $$ LANGUAGE plpgsql`)
    this.schema.raw(`
      CREATE TRIGGER issued_documents_frozen
      BEFORE UPDATE OR DELETE ON issued_documents
      FOR EACH ROW EXECUTE FUNCTION issued_documents_frozen()`)
    this.schema.raw(`
      CREATE TRIGGER issued_documents_not_truncated
      BEFORE TRUNCATE ON issued_documents
      FOR EACH STATEMENT EXECUTE FUNCTION issued_documents_frozen()`)
  }

  async down() {
    this.schema.dropTable('issued_documents')
    this.schema.raw('DROP FUNCTION IF EXISTS issued_documents_frozen()')
  }
}
