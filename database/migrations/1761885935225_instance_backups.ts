import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Nightly off-site backups (#33): where they go, the public key they are
 * encrypted to, and how the last runs went.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('instance_settings', (table) => {
      // S3-compatible storage; the secret is encrypted with APP_KEY
      table.string('backup_endpoint', 255).nullable()
      table.string('backup_bucket', 63).nullable()
      table.string('backup_region', 64).nullable()
      table.string('backup_access_key_id', 128).nullable()
      table.text('backup_secret_access_key').nullable()
      table.integer('backup_retention').notNullable().defaultTo(14)
      // The age public key backups are encrypted to, and its private key
      // encrypted with the Superuser's passphrase, which the server never
      // keeps: the server can't decrypt its own backups
      table.string('backup_recipient', 100).nullable()
      table.text('backup_identity').nullable()
      // Status: when the current run started (shown only while it holds
      // its lock), the last success, the last failure
      table.timestamp('backup_started_at').nullable()
      table.timestamp('backup_succeeded_at').nullable()
      table.string('backup_last_name', 255).nullable()
      table.timestamp('backup_failed_at').nullable()
      table.text('backup_failure').nullable()
    })
    this.schema
      .raw(`ALTER TABLE instance_settings ADD CONSTRAINT instance_settings_backup_retention_check
      CHECK (backup_retention BETWEEN 1 AND 365)`)
  }

  async down() {
    // Dropping backup_retention drops its check too
    this.schema.alterTable('instance_settings', (table) => {
      table.dropColumns(
        'backup_endpoint',
        'backup_bucket',
        'backup_region',
        'backup_access_key_id',
        'backup_secret_access_key',
        'backup_retention',
        'backup_recipient',
        'backup_identity',
        'backup_started_at',
        'backup_succeeded_at',
        'backup_last_name',
        'backup_failed_at',
        'backup_failure'
      )
    })
  }
}
