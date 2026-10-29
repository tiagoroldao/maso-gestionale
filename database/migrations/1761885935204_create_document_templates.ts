import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // The Admin's Document Templates (#29); their content lives in versions
    this.schema.createTable('document_templates', (table) => {
      table.increments('id').notNullable()
      table.string('name', 150).notNullable().unique()
      table.timestamp('archived_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    // Every save adds a version; Issued Documents will point at the one
    // they used, so a version is never changed or deleted
    this.schema.createTable('document_template_versions', (table) => {
      table.increments('id').notNullable()
      table
        .integer('document_template_id')
        .notNullable()
        .references('id')
        .inTable('document_templates')
        .onDelete('RESTRICT')
      table.integer('version').notNullable()
      // The printed title, as it was in this version
      table.string('name', 150).notNullable()
      // A TipTap document (JSON), rendered by shared/document_templates.ts
      table.jsonb('body').notNullable()
      table.jsonb('fields').notNullable().defaultTo('[]')
      // RESTRICT: the version can't change, so it can't lose its author either
      table.integer('created_by').nullable().references('id').inTable('users').onDelete('RESTRICT')
      table.timestamp('created_at').notNullable()
      table.unique(['document_template_id', 'version'])
    })
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION document_template_versions_frozen() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Document Template versions can not be changed';
      END;
      $$ LANGUAGE plpgsql`)
    this.schema.raw(`
      CREATE TRIGGER document_template_versions_frozen
      BEFORE UPDATE OR DELETE ON document_template_versions
      FOR EACH ROW EXECUTE FUNCTION document_template_versions_frozen()`)
  }

  async down() {
    this.schema.dropTable('document_template_versions')
    this.schema.raw('DROP FUNCTION IF EXISTS document_template_versions_frozen()')
    this.schema.dropTable('document_templates')
  }
}
