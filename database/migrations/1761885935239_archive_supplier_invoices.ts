import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Legal archiving (conservazione a norma) of received Supplier Invoices
 * through the SDI intermediary (#214, ADR 0019), under the same Instance
 * setting as sent Invoices. Archiving is per file: the rows of one file
 * (a file may hold several invoices) move together.
 *
 * `legal_archiving` is null when never asked for, then `queued` (waiting
 * to go), `sending` (handed to the intermediary, outside any lock),
 * `requested` (the intermediary took it: `legal_archiving_ids` holds its
 * uuid(s)) or `failed` (`legal_archiving_failure` says why; retried).
 * `legal_archiving_at` is when it last changed: when it was requested,
 * once requested.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('supplier_invoices', (table) => {
      table.string('legal_archiving', 10).nullable().index()
      table.timestamp('legal_archiving_at').nullable()
      table.jsonb('legal_archiving_ids').nullable()
      table.text('legal_archiving_failure').nullable()
      table.check(
        `(legal_archiving IS NULL OR legal_archiving IN ('queued', 'sending', 'requested', 'failed'))
         AND (legal_archiving IS NULL) = (legal_archiving_at IS NULL)
         AND (COALESCE(legal_archiving, '') = 'requested') = (legal_archiving_ids IS NOT NULL)
         AND (COALESCE(legal_archiving, '') = 'failed') = (legal_archiving_failure IS NOT NULL)`,
        [],
        'supplier_invoices_legal_archiving_check'
      )
    })
  }

  async down() {
    this.defer(async (db) => {
      // Which Supplier Invoices went to legal archiving would be lost: refuse
      const archived = await db.rawQuery(
        `SELECT id FROM supplier_invoices WHERE legal_archiving = 'requested' LIMIT 1`
      )
      if (archived.rows.length) {
        throw new Error('Supplier Invoices went to legal archiving: rolling back would lose it')
      }
    })
    this.schema.alterTable('supplier_invoices', (table) => {
      table.dropChecks(['supplier_invoices_legal_archiving_check'])
      table.dropColumn('legal_archiving_failure')
      table.dropColumn('legal_archiving_ids')
      table.dropColumn('legal_archiving_at')
      table.dropColumn('legal_archiving')
    })
  }
}
