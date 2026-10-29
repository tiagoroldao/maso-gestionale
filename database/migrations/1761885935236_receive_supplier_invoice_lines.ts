import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Receiving Supplier Invoice lines into stock (#199). Office goes through
 * an invoice's lines: each is received onto an Item (a receipt Stock
 * Movement at the line's unit cost after discounts) or marked not stock.
 * The invoice is handled once every line is one or the other.
 *
 * An Item gets a link to its Supplier, set (with the supplier's article
 * code) by the first receipt that finds it missing, and only by receipts;
 * suggestions match a line's article code against the Item's supplier
 * code for that Supplier.
 *
 * A line keeps what its receipt changed on the Item (the purchase price
 * before it, and whether it set the supplier code), so undoing the receipt
 * can take those back. Undoing records an adjustment; the receipt itself
 * stays in the ledger.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('items', (table) => {
      table
        .integer('supplier_id')
        .nullable()
        .references('id')
        .inTable('suppliers')
        .onDelete('RESTRICT')
        .index()
    })

    this.schema.alterTable('supplier_invoice_lines', (table) => {
      // null while to handle; 'received' onto an Item, or 'not_stock'
      table.string('outcome', 10).nullable()
      table.integer('item_id').nullable().references('id').inTable('items').onDelete('RESTRICT')
      // The receipt (carico) recorded for it
      table
        .integer('stock_movement_id')
        .nullable()
        .unique()
        .references('id')
        .inTable('stock_movements')
        .onDelete('RESTRICT')
      // The Item's purchase price before the receipt changed it (null if it didn't)
      table.decimal('previous_purchase_price', 14, 4).nullable()
      // Whether the receipt set the Item's supplier code
      table.boolean('set_supplier_code').notNullable().defaultTo(false)
      table.timestamp('handled_at').nullable()
      table.integer('handled_by').nullable().references('id').inTable('users')
      table.check(
        `outcome IS NULL OR outcome IN ('received', 'not_stock')`,
        [],
        'supplier_invoice_lines_outcome_check'
      )
      table.check(
        `(outcome = 'received') = (item_id IS NOT NULL AND stock_movement_id IS NOT NULL)
          AND (outcome = 'received'
            OR (previous_purchase_price IS NULL AND NOT set_supplier_code))
          AND (outcome IS NULL) = (handled_at IS NULL)
          AND (handled_by IS NULL OR handled_at IS NOT NULL)`,
        [],
        'supplier_invoice_lines_received_check'
      )
    })

    this.defer(async (db) => {
      // Invoices Office already marked handled by hand (#198): their lines were dealt with
      await db.rawQuery(`
        UPDATE supplier_invoice_lines l
        SET outcome = 'not_stock', handled_at = i.handled_at, handled_by = i.handled_by
        FROM supplier_invoices i
        WHERE i.id = l.supplier_invoice_id AND i.status = 'handled'
      `)
    })
  }

  async down() {
    // Receipts and adjustments stay in the ledger; only the links to them
    // go. Invoices stay handled or to handle as they are. The checks go
    // with their columns.
    this.schema.alterTable('supplier_invoice_lines', (table) => {
      table.dropColumn('handled_by')
      table.dropColumn('handled_at')
      table.dropColumn('set_supplier_code')
      table.dropColumn('previous_purchase_price')
      table.dropColumn('stock_movement_id')
      table.dropColumn('item_id')
      table.dropColumn('outcome')
    })
    this.schema.alterTable('items', (table) => {
      table.dropColumn('supplier_id')
    })
  }
}
