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
    // The old rule: for a Job with a Quote, Visits that ended by its
    // decision were surveys. A Quote not yet decided would be decided after
    // now, so the Visits already over are surveys too
    this.schema.raw(`UPDATE visits SET survey = true
      WHERE EXISTS (SELECT 1 FROM quotes q
        WHERE q.job_id = visits.job_id
          AND visits.ends_at <= coalesce(q.decided_at, now()))`)
  }

  async down() {
    // The decision dates are untouched, so the date rule takes over again
    this.schema.alterTable('visits', (table) => {
      table.dropColumn('survey')
    })
  }
}
