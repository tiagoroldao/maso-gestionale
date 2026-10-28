import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('quotes', (table) => {
      // When the Quote went to the Customer: from then on it is frozen
      // (ADR 0013). Deciding a draft on the spot sends it too.
      table.timestamp('sent_at').nullable()
      // What the Customer received, copied when sent, so later changes to
      // the Customer, Company settings or the Job's title don't alter it
      table.jsonb('customer_snapshot').nullable()
      table.jsonb('company_snapshot').nullable()
      table.string('subject', 255).nullable()
    })
    this.schema.raw('ALTER TABLE quotes DROP CONSTRAINT quotes_status_check')
    this.schema.raw(
      "ALTER TABLE quotes ADD CONSTRAINT quotes_status_check CHECK (status IN ('draft', 'sent', 'accepted', 'declined'))"
    )
    this.defer(async (db) => {
      // Decided Quotes were sent at the latest when they were decided, as
      // their Customer, company and Job read now (the best we have)
      await db.rawQuery(
        `UPDATE quotes SET
          sent_at = coalesce(quotes.decided_at, quotes.updated_at, quotes.created_at),
          subject = jobs.title,
          customer_snapshot = jsonb_build_object(
            'type', customers.type,
            'name', CASE WHEN customers.type = 'private'
              THEN concat_ws(' ', customers.first_name, customers.last_name)
              ELSE coalesce(customers.name, '') END,
            'firstName', customers.first_name,
            'lastName', customers.last_name,
            'vatNumber', customers.vat_number,
            'taxCode', customers.tax_code,
            'sdiCode', customers.sdi_code,
            'pec', customers.pec,
            'street', customers.street,
            'streetNumber', customers.street_number,
            'postalCode', customers.postal_code,
            'city', customers.city,
            'province', customers.province
          ),
          company_snapshot = (SELECT jsonb_build_object(
            'name', name,
            'street', street,
            'streetNumber', street_number,
            'postalCode', postal_code,
            'city', city,
            'province', province,
            'vatNumber', vat_number,
            'taxCode', tax_code,
            'email', email,
            'phone', phone
          ) FROM company_settings WHERE id = 1)
        FROM jobs JOIN customers ON customers.id = jobs.customer_id
        WHERE jobs.id = quotes.job_id AND quotes.status <> 'draft'`
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
      await db.rawQuery(
        'ALTER TABLE quotes DROP COLUMN sent_at, DROP COLUMN customer_snapshot, DROP COLUMN company_snapshot, DROP COLUMN subject'
      )
    })
  }
}
