import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A Visit marked as a Survey (ADR 0013, #136) instead of being told apart
 * by its Quote's decision date.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('visits', (table) => {
      table.boolean('survey').notNullable().defaultTo(false)
    })
    // The old rule: for a Job whose Quote was decided, Visits that ended by
    // the decision were surveys
    this.schema.raw(`UPDATE visits SET survey = true
      WHERE EXISTS (SELECT 1 FROM quotes q
        WHERE q.job_id = visits.job_id AND q.decided_at IS NOT NULL
          AND visits.ends_at <= q.decided_at)`)
  }

  async down() {
    // The decision dates are untouched, so the date rule takes over again
    this.schema.alterTable('visits', (table) => {
      table.dropColumn('survey')
    })
  }
}
