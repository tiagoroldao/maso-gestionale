import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('invoice_submissions', (table) => {
      // The exact file sent, kept for legal archiving outside the app (ADR 0004)
      table.text('xml').nullable()
      // SDI's notice: the resubmission deadline counts from its date
      table.date('notice_on').nullable()
      table.string('sdi_id', 20).nullable()
    })
    this.schema.raw(
      'UPDATE invoice_submissions SET notice_on = outcome_at::date WHERE outcome IS NOT NULL'
    )
    this.schema.raw(
      `ALTER TABLE invoice_submissions ADD CONSTRAINT invoice_submissions_notice_with_outcome
        CHECK ((outcome IS NULL) = (notice_on IS NULL))`
    )
  }

  async down() {
    this.schema.alterTable('invoice_submissions', (table) => {
      table.dropChecks(['invoice_submissions_notice_with_outcome'])
      table.dropColumns('xml', 'notice_on', 'sdi_id')
    })
  }
}
