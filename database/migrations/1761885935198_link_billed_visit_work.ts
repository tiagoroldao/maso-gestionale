import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // The Invoice that billed the hours or Items: left out of later drafts,
    // and freed again when that draft is deleted
    for (const table of ['visit_hours', 'visit_items']) {
      this.schema.alterTable(table, (t) => {
        t.integer('invoice_id').nullable().references('id').inTable('invoices').onDelete('SET NULL')
        t.index(['invoice_id'])
      })
      // Time & Materials Jobs were invoiced once, for all their work
      this.schema.raw(`
        UPDATE ${table} w SET invoice_id = (
          SELECT min(i.id) FROM invoices i JOIN visits v ON v.job_id = i.job_id
          JOIN jobs j ON j.id = i.job_id
          WHERE v.id = w.visit_id AND j.kind = 'time_and_materials'
        )`)
    }
  }

  async down() {
    for (const table of ['visit_hours', 'visit_items']) {
      this.schema.alterTable(table, (t) => {
        t.dropColumn('invoice_id')
      })
    }
  }
}
