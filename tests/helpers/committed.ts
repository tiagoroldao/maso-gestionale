import db from '@adonisjs/lucid/services/db'

/**
 * Tables a `@committed` test may write to, children first so rows can be
 * deleted in this order.
 */
const TABLES = [
  'stock_movements',
  'invoice_lines',
  'invoices',
  'invoice_sequences',
  'items',
  'customers',
  'users',
]

/**
 * For tests tagged `@committed`, which run outside the global test
 * transaction so that concurrent work uses separate connections and real
 * locks. Call before writing anything; the returned function deletes every
 * row added since and puts Company settings back (use it in `cleanup`).
 */
export async function committedData() {
  const settings = await db.from('company_settings').where('id', 1).first()
  const before = new Map<string, number>()
  for (const table of TABLES) {
    const row = await db.from(table).max('id as max').first()
    before.set(table, Number(row?.max ?? 0))
  }
  return async () => {
    for (const table of TABLES) {
      await db.from(table).where('id', '>', before.get(table)!).delete()
    }
    await db.from('company_settings').where('id', 1).delete()
    if (settings) await db.table('company_settings').insert(settings)
  }
}
