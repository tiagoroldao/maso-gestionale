import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Committed stock (#158) sums each Item's Charges, so the Items list and
 * the Stock page look Charges up by Item.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('charges', (table) => {
      table.index(['item_id'])
    })
  }

  async down() {
    this.schema.alterTable('charges', (table) => {
      table.dropIndex(['item_id'])
    })
  }
}
