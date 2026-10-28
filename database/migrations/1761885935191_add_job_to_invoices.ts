import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('invoices', (table) => {
      // The Job invoiced, if any. A Job's Items leave stock through its
      // Visits, so only Invoices without a Job sell from stock
      table
        .integer('job_id')
        .nullable()
        .references('id')
        .inTable('jobs')
        .onDelete('RESTRICT')
        .index()
    })
  }

  async down() {
    this.schema.alterTable('invoices', (table) => {
      table.dropColumn('job_id')
    })
  }
}
