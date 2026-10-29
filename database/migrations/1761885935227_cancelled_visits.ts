import { BaseSchema } from '@adonisjs/lucid/schema'

const statusCheck = (statuses: string[]) =>
  `ALTER TABLE visits ADD CONSTRAINT visits_status_check
   CHECK (status IN (${statuses.map((status) => `'${status}'`).join(', ')}))`

/**
 * A Visit can be cancelled (ADR 0016, #157): it keeps its record, with the
 * moment it was cancelled, and its Charges become not done.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE visits DROP CONSTRAINT visits_status_check')
    this.schema.raw(statusCheck(['planned', 'in_progress', 'done', 'needs_return', 'cancelled']))
    this.schema.alterTable('visits', (table) => {
      table.timestamp('cancelled_at').nullable()
    })
  }

  async down() {
    this.defer(async (db) => {
      // Refuse rather than guess what a cancelled Visit was: restore it first
      const cancelled = await db.rawQuery("SELECT 1 FROM visits WHERE status = 'cancelled' LIMIT 1")
      if (cancelled.rows.length) {
        throw new Error('Some Visits are cancelled: restore them before rolling back')
      }
      await db.rawQuery('ALTER TABLE visits DROP CONSTRAINT visits_status_check')
      await db.rawQuery(statusCheck(['planned', 'in_progress', 'done', 'needs_return']))
      await db.rawQuery('ALTER TABLE visits DROP COLUMN cancelled_at')
    })
  }
}
