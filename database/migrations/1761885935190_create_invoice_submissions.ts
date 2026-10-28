import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_status_check')
    this.schema.raw(`ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN
      ('draft', 'finalised', 'submitted', 'delivered', 'not_deliverable', 'rejected'))`)

    // Every SDI file needs its own progressive; a letter set by the Admin
    // keeps ours apart from files the old software sent
    this.schema.alterTable('company_settings', (table) => {
      table.string('sdi_file_prefix', 1).notNullable().defaultTo('M')
    })
    this.schema.raw(
      "ALTER TABLE company_settings ADD CONSTRAINT company_settings_sdi_file_prefix_check CHECK (sdi_file_prefix ~ '^[A-Z]$')"
    )
    this.schema.raw('CREATE SEQUENCE sdi_progressive_seq')

    this.schema.createTable('invoice_submissions', (table) => {
      table.increments('id').notNullable()
      // History: Submissions stay with their Invoice
      table
        .integer('invoice_id')
        .notNullable()
        .references('id')
        .inTable('invoices')
        .onDelete('RESTRICT')
        .index()
      table.string('channel', 20).notNullable().defaultTo('manual')
      table.string('progressive', 5).notNullable().unique()
      table.string('file_name', 50).notNullable()
      table.timestamp('prepared_at').notNullable()
      table.integer('prepared_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('submitted_at').nullable()
      table
        .integer('submitted_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('outcome', 20).nullable()
      table.timestamp('outcome_at').nullable()
      table.integer('outcome_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      // SDI's notice: for a Rejection, the error codes and description
      table.text('outcome_notes').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
    this.schema
      .raw(`ALTER TABLE invoice_submissions ADD CONSTRAINT invoice_submissions_outcome_check CHECK (
      (outcome IS NULL OR outcome IN ('delivered', 'not_deliverable', 'rejected'))
      AND (outcome IS NULL OR submitted_at IS NOT NULL)
      AND ((outcome IS NULL) = (outcome_at IS NULL)))`)
    // At most one Submission in progress (no outcome yet) per Invoice
    this.schema.raw(
      'CREATE UNIQUE INDEX invoice_submissions_open_unique ON invoice_submissions (invoice_id) WHERE outcome IS NULL'
    )
  }

  async down() {
    this.schema.dropTable('invoice_submissions')
    this.schema.raw('DROP SEQUENCE sdi_progressive_seq')
    this.schema.raw(
      'ALTER TABLE company_settings DROP CONSTRAINT company_settings_sdi_file_prefix_check'
    )
    this.schema.alterTable('company_settings', (table) => {
      table.dropColumn('sdi_file_prefix')
    })
    this.defer(async (db) => {
      await db.rawQuery(
        "UPDATE invoices SET status = 'finalised' WHERE status NOT IN ('draft', 'finalised')"
      )
    })
    this.schema.raw('ALTER TABLE invoices DROP CONSTRAINT invoices_status_check')
    this.schema.raw(
      "ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'finalised'))"
    )
  }
}
