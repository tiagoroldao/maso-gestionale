import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('labour_rates', (table) => {
      table.increments('id').notNullable()
      // Unique among active rates only (see below), so an archived name can be reused
      table.string('name', 100).notNullable()
      table.decimal('hourly_price', 14, 4).notNullable()
      table.check('hourly_price >= 0')
      table.timestamp('archived_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
    this.schema.raw(
      'CREATE UNIQUE INDEX labour_rates_active_name_unique ON labour_rates (lower(name)) WHERE archived_at IS NULL'
    )

    this.schema.alterTable('company_settings', (table) => {
      // A fixed charge for attending a Visit (Diritto di chiamata)
      table.decimal('call_out_fee', 14, 4).nullable()
    })

    this.schema.createTable('quotes', (table) => {
      table.increments('id').notNullable()
      // One Quote per Job; revising it means editing its lines
      table
        .integer('job_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('jobs')
        .onDelete('CASCADE')
      table.enum('status', ['draft', 'accepted', 'declined']).notNullable().defaultTo('draft')
      table.text('notes').nullable()
      table.timestamp('decided_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('quote_lines', (table) => {
      table.increments('id').notNullable()
      table.integer('quote_id').notNullable().references('id').inTable('quotes').onDelete('CASCADE')
      table.integer('position').notNullable()
      table.enum('kind', ['item', 'labour', 'call_out', 'text']).notNullable()
      table.integer('item_id').nullable().references('id').inTable('items').onDelete('RESTRICT')
      table
        .integer('labour_rate_id')
        .nullable()
        .references('id')
        .inTable('labour_rates')
        .onDelete('RESTRICT')
      table.string('description', 1000).notNullable()
      // Text lines carry no amounts
      table.decimal('quantity', 14, 3).nullable()
      table.string('unit', 10).nullable()
      table.decimal('unit_price', 14, 4).nullable()
      table.decimal('line_total', 14, 2).nullable()
      // Text lines carry no amounts; priced lines carry all three, consistent
      table.check(
        `(kind = 'text' AND quantity IS NULL AND unit_price IS NULL AND line_total IS NULL) OR
         (kind <> 'text' AND quantity IS NOT NULL AND unit_price IS NOT NULL AND line_total IS NOT NULL
          AND line_total = round(quantity * unit_price, 2))`
      )
      // Each kind refers to exactly what it needs
      table.check(`(kind = 'item') = (item_id IS NOT NULL)`)
      table.check(`(kind = 'labour') = (labour_rate_id IS NOT NULL)`)
      table.index(['quote_id', 'position'])
    })
  }

  async down() {
    this.schema.dropTable('quote_lines')
    this.schema.dropTable('quotes')
    this.schema.alterTable('company_settings', (table) => {
      table.dropColumn('call_out_fee')
    })
    this.schema.dropTable('labour_rates')
  }
}
