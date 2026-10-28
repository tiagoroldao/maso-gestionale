import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('quotes', (table) => {
      // When the Quote went to the Customer: from then on it is frozen
      // (ADR 0013). Deciding a draft on the spot sends it too.
      table.timestamp('sent_at').nullable()
    })
    this.schema.raw('ALTER TABLE quotes DROP CONSTRAINT quotes_status_check')
    this.schema.raw(
      "ALTER TABLE quotes ADD CONSTRAINT quotes_status_check CHECK (status IN ('draft', 'sent', 'accepted', 'declined'))"
    )
    // Decided Quotes were sent at the latest when they were decided
    this.defer(async (db) => {
      await db.rawQuery(
        "UPDATE quotes SET sent_at = coalesce(decided_at, updated_at, created_at) WHERE status <> 'draft'"
      )
      await db.rawQuery(
        "ALTER TABLE quotes ADD CONSTRAINT quotes_sent_at_check CHECK ((status = 'draft') = (sent_at IS NULL))"
      )
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.rawQuery('ALTER TABLE quotes DROP CONSTRAINT quotes_sent_at_check')
      // A sent Quote goes back to being a draft
      await db.rawQuery("UPDATE quotes SET status = 'draft' WHERE status = 'sent'")
      await db.rawQuery('ALTER TABLE quotes DROP CONSTRAINT quotes_status_check')
      await db.rawQuery(
        "ALTER TABLE quotes ADD CONSTRAINT quotes_status_check CHECK (status IN ('draft', 'accepted', 'declined'))"
      )
      await db.rawQuery('ALTER TABLE quotes DROP COLUMN sent_at')
    })
  }
}
