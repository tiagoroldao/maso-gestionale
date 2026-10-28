import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A Job has no kind (ADR 0012, #130): what the kind decided now follows
 * from whether the Job has a Quote.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('kind')
    })
  }

  async down() {
    // Back to a kind worked out from the Quote: a Job with one was Quoted
    this.schema.alterTable('jobs', (table) => {
      table
        .enum('kind', ['quoted', 'time_and_materials'])
        .notNullable()
        .defaultTo('time_and_materials')
    })
    this.schema.raw(`UPDATE jobs SET kind = 'quoted'
      WHERE EXISTS (SELECT 1 FROM quotes q WHERE q.job_id = jobs.id)`)
    this.schema.raw('ALTER TABLE jobs ALTER COLUMN kind DROP DEFAULT')
  }
}
