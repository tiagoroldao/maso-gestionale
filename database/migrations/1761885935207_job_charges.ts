import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Charges Office adds to a Job directly (#115): a call-out, a contractor's
 * day, materials bought for the Job, any other cost. They have no Visit,
 * Labour Rate or Item, so they carry their own unit and VAT kind.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE charges DROP CONSTRAINT charges_kind_check')
    this.schema.raw(
      `ALTER TABLE charges ADD CONSTRAINT charges_kind_check
       CHECK (kind IN ('labour', 'item', 'other'))`
    )
    this.schema.alterTable('charges', (table) => {
      table.string('unit', 10).nullable()
      // Which default VAT rule applies when billed (ADR 0008)
      table.enum('vat_kind', ['labour', 'material', 'significant_good']).nullable()
      table.check(`(kind = 'other') = (vat_kind IS NOT NULL)`, [], 'charges_other_vat_kind_check')
      table.check(
        `kind <> 'other' OR (visit_id IS NULL AND item_id IS NULL AND labour_rate_id IS NULL
          AND user_id IS NULL AND worker_name IS NULL)`,
        [],
        'charges_other_fields_check'
      )
    })
  }

  async down() {
    this.schema.raw(`DELETE FROM charges WHERE kind = 'other'`)
    this.schema.alterTable('charges', (table) => {
      table.dropChecks(['charges_other_fields_check', 'charges_other_vat_kind_check'])
      table.dropColumn('vat_kind')
      table.dropColumn('unit')
    })
    this.schema.raw('ALTER TABLE charges DROP CONSTRAINT charges_kind_check')
    this.schema.raw(
      `ALTER TABLE charges ADD CONSTRAINT charges_kind_check CHECK (kind IN ('labour', 'item'))`
    )
  }
}
