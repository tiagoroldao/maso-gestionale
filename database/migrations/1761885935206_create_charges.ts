import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Charges (ADR 0010) replace Visit hours and Visit Items: what was
 * recorded (who, the Labour Rate or Item, the quantity) and what is billed
 * (quantity, price, description), with a history of every change.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('charges', (table) => {
      table.increments('id').notNullable()
      table.integer('job_id').notNullable().references('id').inTable('jobs').onDelete('RESTRICT')
      // Null for a Charge on the Job itself (#115)
      table.integer('visit_id').nullable().references('id').inTable('visits').onDelete('RESTRICT')
      table.enum('kind', ['labour', 'item']).notNullable()

      // Recorded: hours by someone at a Labour Rate, or an Item used
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('RESTRICT')
      // Someone outside the app (a contractor hired for the day)
      table.string('worker_name', 100).nullable()
      table
        .integer('labour_rate_id')
        .nullable()
        .references('id')
        .inTable('labour_rates')
        .onDelete('RESTRICT')
      table.integer('item_id').nullable().references('id').inTable('items').onDelete('RESTRICT')
      table.decimal('quantity', 14, 3).notNullable()
      table.boolean('installed').notNullable().defaultTo(false)
      table
        .integer('installed_equipment_id')
        .nullable()
        .references('id')
        .inTable('installed_equipment')
        .onDelete('SET NULL')
      // Whether installing created the equipment (removing the Charge
      // removes it) or linked equipment already at the Site
      table.boolean('created_equipment').notNullable().defaultTo(false)
      // The usage when the Visit closed; later corrections are adjustments
      table
        .integer('stock_movement_id')
        .nullable()
        .unique()
        .references('id')
        .inTable('stock_movements')
        .onDelete('RESTRICT')

      // Billed: priced when recorded, never sent to Technicians
      table.decimal('bill_quantity', 14, 3).notNullable()
      table.decimal('unit_price', 14, 4).notNullable()
      table.string('description', 255).notNullable()
      // The Invoice that billed it (#75), until invoicing from Charges (#116)
      table
        .integer('invoice_id')
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.check('quantity > 0')
      table.check('bill_quantity > 0')
      table.check(`kind <> 'labour' OR (labour_rate_id IS NOT NULL AND item_id IS NULL
        AND (user_id IS NOT NULL OR btrim(coalesce(worker_name, '')) <> ''))`)
      table.check(`kind <> 'item' OR (item_id IS NOT NULL AND labour_rate_id IS NULL
        AND user_id IS NULL AND worker_name IS NULL)`)
      table.index(['job_id'])
      table.index(['visit_id'])
      table.index(['invoice_id'])
    })

    this.schema.createTable('charge_events', (table) => {
      table.increments('id').notNullable()
      // CASCADE: a Charge removed in the field before anyone reviewed it
      table
        .integer('charge_id')
        .notNullable()
        .references('id')
        .inTable('charges')
        .onDelete('CASCADE')
      table
        .enum('kind', ['recorded', 'corrected', 'billing_edited', 'not_billable', 'billable'])
        .notNullable()
      table.integer('user_id').nullable().references('id').inTable('users').onDelete('RESTRICT')
      // What changed, as { before, after } of displayed values
      table.jsonb('changes').nullable()
      table.timestamp('created_at').notNullable()
      table.index(['charge_id'])
    })
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION charge_events_frozen() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Charge history can not be changed';
      END;
      $$ LANGUAGE plpgsql`)
    this.schema.raw(`
      CREATE TRIGGER charge_events_frozen
      BEFORE UPDATE ON charge_events
      FOR EACH ROW EXECUTE FUNCTION charge_events_frozen()`)

    // Existing hours and Items become Charges, each with its "recorded" event
    this.schema.raw(`
      INSERT INTO charges (job_id, visit_id, kind, user_id, labour_rate_id, quantity,
        bill_quantity, unit_price, description, invoice_id, created_at, updated_at)
      SELECT v.job_id, h.visit_id, 'labour', h.user_id, h.labour_rate_id, h.hours,
        h.hours, h.unit_price, left(r.name || ' – ' || coalesce(u.full_name, u.email), 255),
        h.invoice_id, h.created_at, h.created_at
      FROM visit_hours h
      JOIN visits v ON v.id = h.visit_id
      JOIN labour_rates r ON r.id = h.labour_rate_id
      JOIN users u ON u.id = h.user_id
      ORDER BY h.id`)
    this.schema.raw(`
      INSERT INTO charges (job_id, visit_id, kind, item_id, quantity, installed,
        installed_equipment_id, created_equipment, stock_movement_id, bill_quantity,
        unit_price, description, invoice_id, created_at, updated_at)
      SELECT v.job_id, l.visit_id, 'item', l.item_id, l.quantity, l.installed,
        l.installed_equipment_id, l.created_equipment, l.stock_movement_id, l.quantity,
        l.unit_price, left(i.description, 255), l.invoice_id, l.created_at, l.created_at
      FROM visit_items l
      JOIN visits v ON v.id = l.visit_id
      JOIN items i ON i.id = l.item_id
      ORDER BY l.id`)
    // Who recorded them was never kept
    this.schema.raw(`
      INSERT INTO charge_events (charge_id, kind, user_id, created_at)
      SELECT id, 'recorded', NULL, created_at FROM charges ORDER BY id`)
    this.schema.dropTable('visit_items')
    this.schema.dropTable('visit_hours')
  }

  async down() {
    this.schema.createTable('visit_hours', (table) => {
      table.increments('id').notNullable()
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT')
      table
        .integer('labour_rate_id')
        .notNullable()
        .references('id')
        .inTable('labour_rates')
        .onDelete('RESTRICT')
      table.decimal('hours', 7, 3).notNullable()
      table.decimal('unit_price', 14, 4).notNullable()
      table
        .integer('invoice_id')
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('SET NULL')
      table.check('hours > 0')
      table.timestamp('created_at').notNullable()
      table.index(['visit_id'])
      table.index(['invoice_id'])
    })
    this.schema.createTable('visit_items', (table) => {
      table.increments('id').notNullable()
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT')
      table.decimal('quantity', 14, 3).notNullable()
      table.check('quantity > 0')
      table.decimal('unit_price', 14, 4).notNullable()
      table.boolean('installed').notNullable().defaultTo(false)
      table
        .integer('installed_equipment_id')
        .nullable()
        .references('id')
        .inTable('installed_equipment')
        .onDelete('SET NULL')
      table.boolean('created_equipment').notNullable().defaultTo(false)
      table
        .integer('stock_movement_id')
        .nullable()
        .unique()
        .references('id')
        .inTable('stock_movements')
        .onDelete('RESTRICT')
      table
        .integer('invoice_id')
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('SET NULL')
      table.timestamp('created_at').notNullable()
      table.index(['visit_id'])
      table.index(['invoice_id'])
    })
    // Back with the recorded values; hours by someone outside the app have
    // no place in the old tables and are lost
    this.schema.raw(`
      INSERT INTO visit_hours (visit_id, user_id, labour_rate_id, hours, unit_price,
        invoice_id, created_at)
      SELECT visit_id, user_id, labour_rate_id, least(quantity, 9999), unit_price,
        invoice_id, created_at
      FROM charges WHERE kind = 'labour' AND visit_id IS NOT NULL AND user_id IS NOT NULL
      ORDER BY id`)
    this.schema.raw(`
      INSERT INTO visit_items (visit_id, item_id, quantity, unit_price, installed,
        installed_equipment_id, created_equipment, stock_movement_id, invoice_id, created_at)
      SELECT visit_id, item_id, quantity, unit_price, installed, installed_equipment_id,
        created_equipment, stock_movement_id, invoice_id, created_at
      FROM charges WHERE kind = 'item' AND visit_id IS NOT NULL
      ORDER BY id`)
    this.schema.dropTable('charge_events')
    this.schema.raw('DROP FUNCTION IF EXISTS charge_events_frozen()')
    this.schema.dropTable('charges')
  }
}
