import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Archived Customers and Sites leave lists and pickers; their Jobs,
    // Invoices and documents stay
    for (const table of ['customers', 'sites']) {
      this.schema.alterTable(table, (t) => {
        t.timestamp('archived_at').nullable()
      })
    }

    this.schema.alterTable('installed_equipment', (table) => {
      // Removed equipment leaves the Site's current list; a replacement
      // points at what took its place
      table.date('removed_on').nullable()
      table
        .integer('replaced_by_id')
        .nullable()
        .references('id')
        .inTable('installed_equipment')
        .onDelete('SET NULL')
    })
    this.schema
      .raw(`ALTER TABLE installed_equipment ADD CONSTRAINT installed_equipment_removal_check
      CHECK ((replaced_by_id IS NULL OR removed_on IS NOT NULL) AND replaced_by_id <> id)`)
  }

  async down() {
    this.schema.raw(
      'ALTER TABLE installed_equipment DROP CONSTRAINT installed_equipment_removal_check'
    )
    this.schema.alterTable('installed_equipment', (table) => {
      table.dropColumns('removed_on', 'replaced_by_id')
    })
    for (const table of ['customers', 'sites']) {
      this.schema.alterTable(table, (t) => {
        t.dropColumn('archived_at')
      })
    }
  }
}
