import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * An installed Item's Charge keeps the details of the new equipment it
 * installs (type, make, model, serial number) until it becomes done, when
 * the equipment is created at the Site (#162, ADR 0016). Installing onto
 * equipment already at the Site keeps that unit in installed_equipment_id
 * and the serial number here.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('charges', (table) => {
      table.string('equipment_type', 100).nullable()
      table.string('equipment_make', 100).nullable()
      table.string('equipment_model', 100).nullable()
      table.string('equipment_serial_number', 100).nullable()
    })
  }

  async down() {
    this.schema.alterTable('charges', (table) => {
      table.dropColumn('equipment_type')
      table.dropColumn('equipment_make')
      table.dropColumn('equipment_model')
      table.dropColumn('equipment_serial_number')
    })
  }
}
