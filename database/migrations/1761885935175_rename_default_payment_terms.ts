import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The default Payment Terms are shown to users, so they carry the
 * Italian name for immediate payment (ADR 0006).
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.from('payment_terms').where('name', 'Immediate').update({ name: 'Rimessa diretta' })
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.from('payment_terms').where('name', 'Rimessa diretta').update({ name: 'Immediate' })
    })
  }
}
