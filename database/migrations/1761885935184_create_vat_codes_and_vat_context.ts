import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Seeded VAT Codes, for the commercialista to review (#17). Admin can
 * change them; rates without a Natura code, 0% codes with one.
 */
const SEED = [
  { name: '22%', rate: 22 },
  { name: '10%', rate: 10 },
  { name: '5%', rate: 5 },
  { name: '4%', rate: 4 },
  {
    name: 'Inversione contabile – impianti su edifici',
    rate: 0,
    natura: 'N6.7',
    legal_note:
      "Operazione soggetta a inversione contabile ai sensi dell'art. 17, comma 6, lett. a-ter, DPR 633/1972",
  },
  {
    name: 'Inversione contabile – subappalto edile',
    rate: 0,
    natura: 'N6.3',
    legal_note:
      "Operazione soggetta a inversione contabile ai sensi dell'art. 17, comma 6, lett. a, DPR 633/1972",
  },
  {
    name: 'Esente art. 10',
    rate: 0,
    natura: 'N4',
    legal_note: "Operazione esente ai sensi dell'art. 10 DPR 633/1972",
  },
  { name: 'Non soggetta', rate: 0, natura: 'N2.2', legal_note: 'Operazione non soggetta a IVA' },
]

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('vat_codes', (table) => {
      table.increments('id').notNullable()
      table.string('name', 100).notNullable()
      table.decimal('rate', 5, 2).notNullable()
      table.check('rate >= 0 AND rate < 100')
      // FatturaPA Natura: required exactly when no VAT is charged
      table.string('natura', 4).nullable()
      table.check('(rate = 0) = (natura IS NOT NULL)')
      // Printed on the Invoice, e.g. the law a reverse charge relies on
      table.text('legal_note').nullable()
      // Codes on Invoices are archived, never deleted
      table.timestamp('archived_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
    this.schema.raw(
      'CREATE UNIQUE INDEX vat_codes_active_name_unique ON vat_codes (lower(name)) WHERE archived_at IS NULL'
    )

    this.schema.alterTable('sites', (table) => {
      // Reduced VAT on maintenance and renovation applies to residential buildings
      table.boolean('residential').notNullable().defaultTo(true)
    })

    this.schema.alterTable('jobs', (table) => {
      table
        .enum('work_category', ['new_installation', 'maintenance', 'renovation', 'repair', 'sale'])
        .notNullable()
        .defaultTo('maintenance')
    })

    // Associations and other bodies: 11-digit Codice Fiscale, no Partita IVA
    this.schema.raw('ALTER TABLE customers DROP CONSTRAINT customers_type_check')
    this.schema.raw(
      "ALTER TABLE customers ADD CONSTRAINT customers_type_check CHECK (type IN ('private', 'company', 'condominium', 'organisation'))"
    )

    this.schema.alterTable('items', (table) => {
      // Bene significativo: 10% VAT only up to the value of the rest of the work
      table.boolean('significant_good').notNullable().defaultTo(false)
      table.integer('vat_code_id').nullable().references('id').inTable('vat_codes')
    })

    this.defer(async (db) => {
      const now = new Date()
      await db
        .table('vat_codes')
        .multiInsert(
          SEED.map((code) => ({ natura: null, legal_note: null, ...code, created_at: now }))
        )
      // Items keep their rate, now as the matching code
      await db.rawQuery(
        `UPDATE items SET vat_code_id = vat_codes.id FROM vat_codes
         WHERE vat_codes.natura IS NULL AND vat_codes.rate = items.vat_rate`
      )
      await db.rawQuery('ALTER TABLE items ALTER COLUMN vat_code_id SET NOT NULL')
      await db.rawQuery('ALTER TABLE items DROP COLUMN vat_rate')
    })
  }

  async down() {
    this.schema.alterTable('items', (table) => {
      table.decimal('vat_rate', 5, 2).notNullable().defaultTo(22)
    })
    this.defer(async (db) => {
      await db.rawQuery(
        `UPDATE items SET vat_rate = vat_codes.rate FROM vat_codes
         WHERE vat_codes.id = items.vat_code_id AND vat_codes.rate IN (4, 5, 10, 22)`
      )
      await db.rawQuery(
        'ALTER TABLE items ADD CONSTRAINT items_vat_rate_check CHECK (vat_rate IN (4, 5, 10, 22))'
      )
      await db.rawQuery('ALTER TABLE items DROP COLUMN vat_code_id, DROP COLUMN significant_good')
      await db.rawQuery("DELETE FROM customers WHERE type = 'organisation'")
      await db.rawQuery('ALTER TABLE customers DROP CONSTRAINT customers_type_check')
      await db.rawQuery(
        "ALTER TABLE customers ADD CONSTRAINT customers_type_check CHECK (type IN ('private', 'company', 'condominium'))"
      )
      await db.rawQuery('ALTER TABLE jobs DROP COLUMN work_category')
      await db.rawQuery('ALTER TABLE sites DROP COLUMN residential')
      await db.rawQuery('DROP TABLE vat_codes')
    })
  }
}
