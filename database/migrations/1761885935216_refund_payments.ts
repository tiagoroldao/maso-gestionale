import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // A refund is a negative Payment; only zero isn't a payment (ADR 0014)
    this.schema.raw('ALTER TABLE payments DROP CONSTRAINT payments_amount_check')
    this.schema.raw('ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount <> 0)')
  }

  async down() {
    // Refunds can't stay once Payments are positive again
    this.schema.raw('DELETE FROM payments WHERE amount < 0')
    this.schema.raw('ALTER TABLE payments DROP CONSTRAINT payments_amount_check')
    this.schema.raw('ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount > 0)')
  }
}
