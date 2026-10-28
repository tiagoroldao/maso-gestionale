import db from '@adonisjs/lucid/services/db'

/**
 * Tables a `@committed` test may write to, children first so rows can be
 * deleted in this order.
 */
const TABLES = [
  'advance_deductions',
  'invoice_submissions',
  'invoice_line_charges',
  'charge_events',
  'issued_documents',
  'document_template_versions',
  'document_templates',
  'stock_movements',
  'invoice_lines',
  'invoices',
  'charges',
  'jobs',
  'sites',
  'invoice_sequences',
  'items',
  'customers',
  'users',
]

/**
 * Tables whose rows a trigger keeps from being deleted (frozen records):
 * the trigger is turned off while cleaning up, inside the cleanup's
 * transaction, so a failure rolls it back on. Rows are deleted, never
 * truncated, which a separate trigger refuses.
 */
const FROZEN: Record<string, string> = {
  issued_documents: 'issued_documents_frozen',
  document_template_versions: 'document_template_versions_frozen',
}

/**
 * For tests tagged `@committed`, which run outside the global test
 * transaction so that concurrent work uses separate connections and real
 * locks. Call before writing anything; the returned function deletes every
 * row added since and puts Company settings back (use it in `cleanup`).
 * It doesn't undo edits to rows that already existed, and a test writing
 * to a table missing from TABLES leaves rows behind: add the table first.
 */
export async function committedData() {
  const settings = await db.from('company_settings').where('id', 1).first()
  const before = new Map<string, number>()
  for (const table of TABLES) {
    const row = await db.from(table).max('id as max').first()
    before.set(table, Number(row?.max ?? 0))
  }
  return async () => {
    await db.transaction(async (trx) => {
      for (const table of TABLES) {
        const trigger = Object.hasOwn(FROZEN, table) ? FROZEN[table] : null
        if (trigger) await trx.rawQuery(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`)
        await trx.from(table).where('id', '>', before.get(table)!).delete()
        if (trigger) await trx.rawQuery(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`)
      }
    })
    await db.from('company_settings').where('id', 1).delete()
    if (settings) await db.table('company_settings').insert(settings)
  }
}
