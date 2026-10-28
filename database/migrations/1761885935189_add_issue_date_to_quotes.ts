import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('quotes', (table) => {
      // The date printed on the Quote: its last save while a draft, frozen
      // once it is accepted or declined
      table.date('issued_on').nullable()
      // Optional validity printed on the PDF ("valido fino al …")
      table.integer('validity_days').nullable()
    })
    this.schema.raw(
      'ALTER TABLE quotes ADD CONSTRAINT quotes_validity_days_check CHECK (validity_days IS NULL OR validity_days BETWEEN 1 AND 365)'
    )
    // Best estimate for existing Quotes: decided ones were last touched by
    // the decision, so use their creation date
    this.defer(async (db) => {
      await db.rawQuery(
        "UPDATE quotes SET issued_on = (CASE WHEN status = 'draft' THEN coalesce(updated_at, created_at) ELSE created_at END)::date"
      )
    })
  }

  async down() {
    this.schema.alterTable('quotes', (table) => {
      table.dropColumns('issued_on', 'validity_days')
    })
  }
}
