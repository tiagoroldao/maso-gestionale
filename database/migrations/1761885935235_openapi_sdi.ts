import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Openapi as SDI intermediary (#92, ADR 0019): its token and environment
 * in Instance settings, the polling status, Submissions sent outside the
 * Invoice lock, and the files received through it.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(
      'ALTER TABLE instance_settings DROP CONSTRAINT IF EXISTS instance_settings_values_check'
    )
    // Invoicetronic was never selectable: nothing to carry over
    this.schema.raw("UPDATE instance_settings SET sdi_mode = 'manual' WHERE sdi_mode <> 'manual'")
    this.schema.alterTable('instance_settings', (table) => {
      // Encrypted with APP_KEY, never sent back to the page
      table.renameColumn('invoicetronic_api_key', 'openapi_token')
      table.string('sdi_environment', 20).notNullable().defaultTo('sandbox')
      // A webhook call asks the poller for an earlier poll
      table.timestamp('sdi_poll_requested_at').nullable()
      table.timestamp('sdi_polled_at').nullable()
      table.text('sdi_poll_failure').nullable()
    })
    this.schema.raw(`ALTER TABLE instance_settings ADD CONSTRAINT instance_settings_values_check
      CHECK (id = 1 AND sdi_mode IN ('manual', 'openapi')
        AND sdi_environment IN ('sandbox', 'production') AND polling_minutes BETWEEN 5 AND 1440)`)

    this.schema.alterTable('invoice_submissions', (table) => {
      // The intermediary's id for the file, to poll its outcome
      table.string('remote_id', 64).nullable()
      // When the app started sending it, outside the Invoice lock: with no
      // submitted_at yet, the send is under way or its result unknown
      table.timestamp('sending_at').nullable()
      // Why the last send failed
      table.text('send_failure').nullable()
    })
    this.schema.raw(
      `CREATE UNIQUE INDEX invoice_submissions_remote_unique ON invoice_submissions (channel, remote_id)
        WHERE remote_id IS NOT NULL`
    )

    // Supplier Invoice files received through the intermediary, kept until
    // the Supplier Invoice intake (#198) takes them
    this.schema.createTable('sdi_received_files', (table) => {
      table.increments('id').notNullable()
      table.string('channel', 20).notNullable()
      table.string('remote_id', 64).notNullable()
      table.string('file_name', 100).notNullable()
      // The file as SDI delivered it: XML or signed .p7m
      table.binary('content').notNullable()
      table.string('sdi_id', 20).nullable()
      // When the intermediary received it
      table.timestamp('received_at').notNullable()
      table.timestamp('handed_at').nullable()
      table.text('failure').nullable()
      table.timestamp('created_at').notNullable()
      table.unique(['channel', 'remote_id'])
    })
  }

  async down() {
    this.schema.dropTable('sdi_received_files')
    this.schema.raw('DROP INDEX invoice_submissions_remote_unique')
    this.schema.alterTable('invoice_submissions', (table) => {
      table.dropColumns('remote_id', 'sending_at', 'send_failure')
    })
    this.schema.raw('ALTER TABLE instance_settings DROP CONSTRAINT instance_settings_values_check')
    this.schema.raw("UPDATE instance_settings SET sdi_mode = 'manual' WHERE sdi_mode <> 'manual'")
    this.schema.alterTable('instance_settings', (table) => {
      table.renameColumn('openapi_token', 'invoicetronic_api_key')
      table.dropColumns(
        'sdi_environment',
        'sdi_poll_requested_at',
        'sdi_polled_at',
        'sdi_poll_failure'
      )
    })
    this.schema.raw(`ALTER TABLE instance_settings ADD CONSTRAINT instance_settings_values_check
      CHECK (id = 1 AND sdi_mode IN ('manual', 'invoicetronic') AND polling_minutes BETWEEN 5 AND 1440)`)
  }
}
