import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Supplier Invoice lines already received by hand, and the cost Office
 * confirms (#210).
 *
 * A line can be marked "già ricevuto" (`already_received`): the goods
 * came in earlier and were received by hand on the Item's page, so stock
 * doesn't move. The line names the Item and, optionally, that earlier
 * receipt (`stock_movement_id`, still unique: a receipt answers for one
 * line at most); it keeps the cost Office confirmed (`unit_cost`), and
 * whether it gave the earlier receipt that cost because it had none
 * (`set_receipt_cost`), so undoing can take it back.
 *
 * A receipt recorded by receiving a line remembers that line
 * (`stock_movements.supplier_invoice_line_id`), even once undone: the
 * receipts "received by hand" that can be linked, and that the page
 * hints at, are those with none.
 *
 * An invoice says whether its discounts (ScontoMaggiorazione in the
 * document's general data, and negative lines) are spread over its lines'
 * default costs (`spread_discounts`, off until Office switches it on).
 * The delivery notes (DatiDDT) and those discounts are read into
 * `details` from now on; invoices received before have none recorded.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('supplier_invoices', (table) => {
      table.boolean('spread_discounts').notNullable().defaultTo(false)
    })

    this.schema.alterTable('stock_movements', (table) => {
      table
        .integer('supplier_invoice_line_id')
        .nullable()
        .references('id')
        .inTable('supplier_invoice_lines')
        .onDelete('RESTRICT')
        .index()
    })

    this.schema.alterTable('supplier_invoice_lines', (table) => {
      table.dropChecks([
        'supplier_invoice_lines_outcome_check',
        'supplier_invoice_lines_received_check',
      ])
    })
    // 'already_received' is longer than the 10 characters the outcome had
    this.schema.raw(`ALTER TABLE supplier_invoice_lines ALTER COLUMN outcome TYPE varchar(20)`)
    this.schema.alterTable('supplier_invoice_lines', (table) => {
      // The cost Office confirmed for a line already received (null: none)
      table.decimal('unit_cost', 14, 4).nullable()
      // Whether marking it already received gave the earlier receipt that cost
      table.boolean('set_receipt_cost').notNullable().defaultTo(false)
      table.check(
        `outcome IS NULL OR outcome IN ('received', 'already_received', 'not_stock')`,
        [],
        'supplier_invoice_lines_outcome_check'
      )
      table.check(
        `(outcome IN ('received', 'already_received')) IS TRUE = (item_id IS NOT NULL)
          AND (outcome IS DISTINCT FROM 'received' OR stock_movement_id IS NOT NULL)
          AND ((outcome IN ('received', 'already_received')) IS TRUE OR stock_movement_id IS NULL)
          AND ((outcome IN ('received', 'already_received')) IS TRUE
            OR (previous_purchase_price IS NULL AND NOT set_supplier_code))
          AND (outcome IS NOT DISTINCT FROM 'already_received' OR unit_cost IS NULL)
          AND (NOT set_receipt_cost
            OR (outcome IS NOT DISTINCT FROM 'already_received' AND stock_movement_id IS NOT NULL))
          AND (outcome IS NULL) = (handled_at IS NULL)
          AND (handled_by IS NULL OR handled_at IS NOT NULL)`,
        [],
        'supplier_invoice_lines_received_check'
      )
    })

    this.defer(async (db) => {
      // Receipts of lines received so far (those undone before can't be told apart)
      await db.rawQuery(`
        UPDATE stock_movements sm SET supplier_invoice_line_id = l.id
        FROM supplier_invoice_lines l
        WHERE l.stock_movement_id = sm.id AND l.outcome = 'received'
      `)
      await db.rawQuery(`
        UPDATE supplier_invoices
        SET details = details || '{"deliveryNotes": [], "discounts": []}'::jsonb
        WHERE details -> 'discounts' IS NULL
      `)
    })
  }

  async down() {
    this.defer(async (db) => {
      // A line already received would come back as neither received nor to handle
      const already = await db.rawQuery(
        `SELECT id FROM supplier_invoice_lines WHERE outcome = 'already_received' LIMIT 1`
      )
      if (already.rows.length) {
        throw new Error('Some Supplier Invoice lines are marked already received: undo them first')
      }
      await db.rawQuery(
        `UPDATE supplier_invoices SET details = details - 'deliveryNotes' - 'discounts'`
      )
    })
    this.schema.alterTable('supplier_invoice_lines', (table) => {
      table.dropChecks([
        'supplier_invoice_lines_outcome_check',
        'supplier_invoice_lines_received_check',
      ])
    })
    this.schema.raw(`ALTER TABLE supplier_invoice_lines ALTER COLUMN outcome TYPE varchar(10)`)
    this.schema.alterTable('supplier_invoice_lines', (table) => {
      table.dropColumn('set_receipt_cost')
      table.dropColumn('unit_cost')
      table.check(
        `outcome IS NULL OR outcome IN ('received', 'not_stock')`,
        [],
        'supplier_invoice_lines_outcome_check'
      )
      table.check(
        `(outcome IS NOT DISTINCT FROM 'received') = (item_id IS NOT NULL)
          AND (outcome IS NOT DISTINCT FROM 'received') = (stock_movement_id IS NOT NULL)
          AND (outcome IS NOT DISTINCT FROM 'received'
            OR (previous_purchase_price IS NULL AND NOT set_supplier_code))
          AND (outcome IS NULL) = (handled_at IS NULL)
          AND (handled_by IS NULL OR handled_at IS NOT NULL)`,
        [],
        'supplier_invoice_lines_received_check'
      )
    })
    this.schema.alterTable('stock_movements', (table) => {
      table.dropColumn('supplier_invoice_line_id')
    })
    this.schema.alterTable('supplier_invoices', (table) => {
      table.dropColumn('spread_discounts')
    })
  }
}
