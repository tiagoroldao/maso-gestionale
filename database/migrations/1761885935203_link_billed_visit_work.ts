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
      // Time & Materials Jobs were invoiced once, for all the work recorded
      // by then (no Visit with work could still be open); later work isn't
      this.schema.raw(`
        UPDATE ${table} w SET invoice_id = i.id
        FROM visits v, invoices i, jobs j
        WHERE v.id = w.visit_id AND i.job_id = v.job_id AND j.id = i.job_id
          AND j.kind = 'time_and_materials' AND w.created_at <= i.created_at`)
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
