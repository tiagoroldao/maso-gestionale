import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Items say whether they are Equipment (a done Charge of one creates
 * Installed Equipment at the Site) and whether their Charges are
 * Groupable on one Invoice line (#176, ADR 0016). Existing Items get the
 * defaults new ones start with: Equipment when they have a maintenance
 * interval, Groupable unless Equipment or a significant good.
 *
 * Charges lose their "installed" flag, their link to a unit already at
 * the Site and their "created equipment" flag: the Item decides, and the
 * equipment a Charge created points back at it instead (one Charge can
 * create several units). Existing Charges get nothing back from the flag
 * (dev data only); the units Charges created keep their link.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('items', (table) => {
      table.boolean('equipment').notNullable().defaultTo(false)
      table.boolean('groupable').notNullable().defaultTo(true)
    })
    this.schema.raw('UPDATE items SET equipment = maintenance_interval_months IS NOT NULL')
    this.schema.raw('UPDATE items SET groupable = NOT (equipment OR significant_good)')

    this.schema.alterTable('installed_equipment', (table) => {
      // The Charge that created it when done; reused if done again
      table.integer('charge_id').nullable().references('id').inTable('charges').onDelete('SET NULL')
      table.index(['charge_id'])
    })
    this.schema.raw(`
      UPDATE installed_equipment e SET charge_id = c.id
      FROM charges c
      WHERE c.installed_equipment_id = e.id AND c.created_equipment`)
    this.schema.alterTable('charges', (table) => {
      table.dropColumn('installed')
      table.dropColumn('installed_equipment_id')
      table.dropColumn('created_equipment')
    })
  }

  async down() {
    this.schema.alterTable('charges', (table) => {
      table.boolean('installed').notNullable().defaultTo(false)
      table
        .integer('installed_equipment_id')
        .nullable()
        .references('id')
        .inTable('installed_equipment')
        .onDelete('SET NULL')
      table.boolean('created_equipment').notNullable().defaultTo(false)
    })
    // One unit per Charge before: the first it created
    this.schema.raw(`
      UPDATE charges c
      SET installed = true, installed_equipment_id = e.id, created_equipment = true
      FROM (
        SELECT charge_id, min(id) AS id FROM installed_equipment
        WHERE charge_id IS NOT NULL GROUP BY charge_id
      ) e
      WHERE e.charge_id = c.id`)
    this.schema.alterTable('installed_equipment', (table) => {
      table.dropColumn('charge_id')
    })
    this.schema.alterTable('items', (table) => {
      table.dropColumn('equipment')
      table.dropColumn('groupable')
    })
  }
}
