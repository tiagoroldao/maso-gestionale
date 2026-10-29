import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * When a Visit was marked in progress and when it was closed (done, or
 * needs another visit), and by whom (#174). Visits closed before this
 * change keep them empty: no backfill.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('visits', (table) => {
      table.timestamp('started_at').nullable()
      table
        .integer('started_by_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('closed_at').nullable()
      table
        .integer('closed_by_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable('visits', (table) => {
      table.dropColumn('started_at')
      table.dropColumn('started_by_id')
      table.dropColumn('closed_at')
      table.dropColumn('closed_by_id')
    })
  }
}
