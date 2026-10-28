import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Several Quotes per Job, numbered from it, and a Job's status that
 * follows its work only (ADR 0013, #138): "quoted" and "accepted" are no
 * longer Job statuses.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('quotes', (table) => {
      // "2026/0007-2": the Quote's place among its Job's Quotes
      table.integer('sequence').nullable()
    })
    // Every Quote so far was its Job's only one
    this.schema.raw('UPDATE quotes SET sequence = 1')
    this.schema.alterTable('quotes', (table) => {
      table.integer('sequence').notNullable().alter()
      table.dropUnique(['job_id'])
      table.unique(['job_id', 'sequence'])
    })

    // Open until a work Visit is planned (Surveys don't count), then in
    // progress, whatever the Job's Quotes say
    this.schema.raw(`UPDATE jobs SET status = CASE
        WHEN EXISTS (SELECT 1 FROM visits v WHERE v.job_id = jobs.id AND NOT v.survey)
        THEN 'in_progress' ELSE 'open' END
      WHERE status <> 'cancelled'`)
    this.schema.raw('ALTER TABLE jobs DROP CONSTRAINT jobs_status_check')
    this.schema.raw(
      "ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('open', 'in_progress', 'cancelled'))"
    )
  }

  async down() {
    this.defer(async (db) => {
      // One Quote per Job again: refuse rather than delete Quotes
      const several = await db.rawQuery(
        'SELECT job_id FROM quotes GROUP BY job_id HAVING count(*) > 1 LIMIT 1'
      )
      if (several.rows.length) {
        throw new Error('Some Jobs have several Quotes: one Quote per Job can not be restored')
      }

      await db.rawQuery('ALTER TABLE jobs DROP CONSTRAINT jobs_status_check')
      await db.rawQuery(
        "ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('open', 'quoted', 'accepted', 'in_progress', 'cancelled'))"
      )
      // As the Quote used to move the Job: work started only once it was
      // accepted; before that the Job was quoted while the Quote had a
      // priced line. A declined Quote leaves the Job open (it used to
      // cancel it, but nobody cancelled these)
      await db.rawQuery(`UPDATE jobs SET status = CASE
          WHEN q.status = 'accepted' AND jobs.status = 'open' THEN 'accepted'
          WHEN q.status IN ('draft', 'sent') AND EXISTS (SELECT 1 FROM quote_lines l
            WHERE l.quote_id = q.id AND l.kind <> 'text') THEN 'quoted'
          WHEN q.status IN ('draft', 'sent') THEN 'open'
          ELSE jobs.status END
        FROM quotes q
        WHERE q.job_id = jobs.id AND jobs.status <> 'cancelled'`)

      await db.rawQuery('ALTER TABLE quotes DROP CONSTRAINT quotes_job_id_sequence_unique')
      await db.rawQuery('ALTER TABLE quotes DROP COLUMN sequence')
      await db.rawQuery('ALTER TABLE quotes ADD CONSTRAINT quotes_job_id_unique UNIQUE (job_id)')
    })
  }
}
