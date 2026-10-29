import { BaseSchema } from '@adonisjs/lucid/schema'

const ARCHIVING_CHECK = 'supplier_invoices_legal_archiving_check'

/** The archiving states' constraint, with or without `automatic` */
function archivingCheck(states: string[]) {
  return `(legal_archiving IS NULL OR legal_archiving IN (${states.map((state) => `'${state}'`).join(', ')}))
    AND (legal_archiving IS NULL) = (legal_archiving_at IS NULL)
    AND (COALESCE(legal_archiving, '') = 'requested') = (legal_archiving_ids IS NOT NULL)
    AND (COALESCE(legal_archiving, '') = 'failed') = (legal_archiving_failure IS NOT NULL)`
}

/**
 * Legal archiving (conservazione a norma) mirrors the intermediary's
 * account setting (#224, ADR 0019): Openapi archives only for a Business
 * Registry Configuration with `apply_legal_storage`, set outside the app.
 *
 * The Superuser's switch (`sdi_legal_archiving`) goes. The poller stores
 * the account setting as read (`sdi_legal_storage`, null until read) and
 * when (`sdi_legal_storage_read_at`).
 *
 * A Supplier Invoice received through the intermediary is archived by the
 * account on receipt, so the app no longer imports it: its archiving is
 * `automatic` when the account archived on receipt. Such invoices still
 * waiting to be imported (queued, sending or failed: never requested) are
 * cleared. Uploaded ones keep their archiving.
 *
 * Rolling back restores the switch, on when the account was read as
 * archiving, and clears `automatic` (nothing was requested for those).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('instance_settings', (table) => {
      table.dropColumn('sdi_legal_archiving')
      table.boolean('sdi_legal_storage').nullable()
      table.timestamp('sdi_legal_storage_read_at').nullable()
    })
    this.schema.raw(`
      UPDATE supplier_invoices
         SET legal_archiving = NULL, legal_archiving_at = NULL, legal_archiving_failure = NULL
       WHERE received_via = 'sdi' AND legal_archiving IN ('queued', 'sending', 'failed')
    `)
    this.schema.raw(`
      ALTER TABLE supplier_invoices
        DROP CONSTRAINT ${ARCHIVING_CHECK},
        ADD CONSTRAINT ${ARCHIVING_CHECK}
          CHECK (${archivingCheck(['queued', 'sending', 'requested', 'failed', 'automatic'])})
    `)
  }

  async down() {
    this.schema.raw(`
      UPDATE supplier_invoices SET legal_archiving = NULL, legal_archiving_at = NULL
       WHERE legal_archiving = 'automatic'
    `)
    this.schema.raw(`
      ALTER TABLE supplier_invoices
        DROP CONSTRAINT ${ARCHIVING_CHECK},
        ADD CONSTRAINT ${ARCHIVING_CHECK}
          CHECK (${archivingCheck(['queued', 'sending', 'requested', 'failed'])})
    `)
    this.schema.alterTable('instance_settings', (table) => {
      table.boolean('sdi_legal_archiving').notNullable().defaultTo(false)
    })
    this.schema.raw(
      'UPDATE instance_settings SET sdi_legal_archiving = COALESCE(sdi_legal_storage, false)'
    )
    this.schema.alterTable('instance_settings', (table) => {
      table.dropColumn('sdi_legal_storage_read_at')
      table.dropColumn('sdi_legal_storage')
    })
  }
}
