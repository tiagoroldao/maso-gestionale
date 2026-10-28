import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('visit_items', (table) => {
      // Whether installing this line created the equipment (removing the
      // line removes it) or linked equipment already at the Site
      table.boolean('created_equipment').notNullable().defaultTo(false)
    })
    this.schema.raw(
      'UPDATE visit_items SET created_equipment = true WHERE installed_equipment_id IS NOT NULL'
    )

    // Equipment serviced on a Visit; closing the Visit dates their service
    this.schema.createTable('visit_serviced_equipment', (table) => {
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table
        .integer('installed_equipment_id')
        .notNullable()
        .references('id')
        .inTable('installed_equipment')
        .onDelete('CASCADE')
      table.primary(['visit_id', 'installed_equipment_id'])
    })
  }

  async down() {
    this.schema.dropTable('visit_serviced_equipment')
    this.schema.alterTable('visit_items', (table) => {
      table.dropColumn('created_equipment')
    })
  }
}
