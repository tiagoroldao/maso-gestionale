import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The default Payment Terms are shown to users, so they carry the
 * Italian name for immediate payment (ADR 0006). Each direction does
 * nothing when the target name is already taken.
 */
export default class extends BaseSchema {
  async up() {
    this.defer((db) => this.rename(db, 'Immediate', 'Rimessa diretta'))
  }

  async down() {
    this.defer((db) => this.rename(db, 'Rimessa diretta', 'Immediate'))
  }

  private async rename(db: Parameters<Parameters<this['defer']>[0]>[0], from: string, to: string) {
    const taken = await db.from('payment_terms').where('name', to).first()
    if (taken) return
    await db.from('payment_terms').where('name', from).update({ name: to })
  }
}
