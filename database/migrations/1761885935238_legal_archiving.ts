import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Legal archiving (conservazione a norma) through the SDI intermediary, as
 * an Instance setting (#205, ADR 0019): off until the Superuser switches
 * it on, and only for an intermediary that offers it. Each Submission
 * records whether it was sent with archiving requested.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('instance_settings', (table) => {
      table.boolean('sdi_legal_archiving').notNullable().defaultTo(false)
    })
    this.schema.alterTable('invoice_submissions', (table) => {
      table.boolean('legal_archiving').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.defer(async (db) => {
      // Which Invoices went to legal archiving would be lost: refuse
      const archived = await db.rawQuery(
        'SELECT id FROM invoice_submissions WHERE legal_archiving LIMIT 1'
      )
      if (archived.rows.length) {
        throw new Error('Submissions were sent with legal archiving: rolling back would lose it')
      }
    })
    this.schema.alterTable('invoice_submissions', (table) => {
      table.dropColumn('legal_archiving')
    })
    this.schema.alterTable('instance_settings', (table) => {
      table.dropColumn('sdi_legal_archiving')
    })
  }
}
