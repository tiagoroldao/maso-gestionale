import { BaseSchema } from '@adonisjs/lucid/schema'

const OLD_KINDS = [
  'recorded',
  'corrected',
  'billing_edited',
  'not_billable',
  'billable',
  'billed',
  'unbilled',
]
const KINDS = [...OLD_KINDS, 'credited', 'uncredited']

const kindCheck = (kinds: string[]) =>
  `ALTER TABLE charge_events ADD CONSTRAINT charge_events_kind_check
   CHECK (kind IN (${kinds.map((kind) => `'${kind}'`).join(', ')}))`

const billingCheck = (kinds: string[]) =>
  `ALTER TABLE charge_events ADD CONSTRAINT charge_events_billing_check
   CHECK ((kind IN (${kinds.map((kind) => `'${kind}'`).join(', ')})) = (invoice_id IS NOT NULL)
     AND (kind = 'billed') = (amount IS NOT NULL))`

/**
 * Credit Notes credit Charges (#146, ADR 0014): a Charge whose Invoice
 * line its Credit Notes credit in full gets a "credited" event, naming the
 * Credit Note and the credited line; a corrected Credit Note that no
 * longer credits the line in full gives it back with an "uncredited" one.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck(KINDS))
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_billing_check')
    this.schema.raw(billingCheck(['billed', 'unbilled', 'credited', 'uncredited']))
  }

  /**
   * Credited Charges go back to billed, as before Credit Notes credited
   * them (#145).
   */
  async down() {
    this.schema.raw(`DELETE FROM charge_events WHERE kind IN ('credited', 'uncredited')`)
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_billing_check')
    this.schema.raw(billingCheck(['billed', 'unbilled']))
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck(OLD_KINDS))
  }
}
