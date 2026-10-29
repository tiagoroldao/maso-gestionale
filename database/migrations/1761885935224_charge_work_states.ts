import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

const OLD_KINDS = [
  'recorded',
  'corrected',
  'billing_edited',
  'not_billable',
  'billable',
  'billed',
  'unbilled',
  'credited',
  'uncredited',
]
const WORK_KINDS = ['planned', 'done', 'not_done']

const kindCheck = (kinds: string[]) =>
  `ALTER TABLE charge_events ADD CONSTRAINT charge_events_kind_check
   CHECK (kind IN (${kinds.map((kind) => `'${kind}'`).join(', ')}))`

const JOB_NUMBER = `concat(j.year, '/', lpad(j.sequence::text, greatest(4, length(j.sequence::text)), '0'))`

type Row = {
  id: number
  kind: string
  visit_id: number | null
  visit_closed: boolean | null
  visit_day: string | null
  item_id: number | null
  quantity: string
  stock_movement_id: number | null
  invoiced_on: string | null
  job_number: string
}

/**
 * Gives every Charge without one its work state (ADR 0016), from what
 * happened so far:
 * - on a Visit: planned while the Visit is open; once closed, done, except
 *   an Item that never left stock and no Invoice ever held, which is not
 *   done (only a Charge this migration's down made planned again);
 * - on the Job itself: done (Office's costs, imported hours and call-outs),
 *   except an Item, only ever imported from a Quote, which is planned
 *   until Office confirms it used, unless an Invoice billed it or a draft
 *   holds it (or it already left stock): then the work was done.
 * A planned Charge needs no event. An Item becoming done here that never
 * left stock does now: a usage on its Visit's day, or on the day it was
 * billed (or drafted), referencing the Job, as closing the Visit or
 * confirming it used would have done.
 */
export async function migrateWorkStates(db: Pick<QueryClientContract, 'rawQuery'>) {
  const { rows }: { rows: Row[] } = await db.rawQuery(`
    SELECT c.id, c.kind, c.visit_id, c.item_id, c.quantity, c.stock_movement_id,
      v.status IN ('done', 'needs_return') AS visit_closed,
      to_char(v.starts_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS visit_day,
      to_char(coalesce(
        (SELECT min(e.created_at) FROM charge_events e
          WHERE e.charge_id = c.id AND e.kind = 'billed'),
        (SELECT min(lc.created_at) FROM invoice_line_charges lc WHERE lc.charge_id = c.id)
      ) AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS invoiced_on,
      ${JOB_NUMBER} AS job_number
    FROM charges c
    JOIN jobs j ON j.id = c.job_id
    LEFT JOIN visits v ON v.id = c.visit_id
    WHERE NOT EXISTS (SELECT 1 FROM charge_events e
      WHERE e.charge_id = c.id AND e.kind IN ('planned', 'done', 'not_done'))
    ORDER BY c.id`)

  for (const row of rows) {
    const item = row.kind === 'item'
    const offStock = row.stock_movement_id !== null
    let work: 'planned' | 'done' | 'not_done'
    if (row.visit_id) {
      if (!row.visit_closed) work = 'planned'
      else work = item && !offStock && !row.invoiced_on ? 'not_done' : 'done'
    } else {
      work = item && !offStock && !row.invoiced_on ? 'planned' : 'done'
    }
    if (work === 'planned') continue

    await db.rawQuery(
      `INSERT INTO charge_events (charge_id, kind, user_id, created_at) VALUES (?, ?, NULL, now())`,
      [row.id, work]
    )
    if (work !== 'done' || !item || offStock) continue
    const occurredOn = row.visit_day ?? row.invoiced_on!
    const movement = await db.rawQuery(
      `INSERT INTO stock_movements (item_id, kind, quantity, occurred_on, reference, created_at)
       VALUES (?, 'usage', -(?::numeric), ?, ?, now()) RETURNING id`,
      [row.item_id!, row.quantity, occurredOn, row.job_number]
    )
    await db.rawQuery('UPDATE charges SET stock_movement_id = ? WHERE id = ?', [
      movement.rows[0].id,
      row.id,
    ])
  }
}

/**
 * Charges have a work state (#156, ADR 0016): planned, done or not done,
 * kept as "planned", "done" and "not done" events in their history.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck([...OLD_KINDS, ...WORK_KINDS]))
    this.defer((db) => migrateWorkStates(db))
  }

  /**
   * Drops the work events. Stock Movements stay: they record what left
   * the Warehouse, and an Item linked to one counts as done if migrated
   * up again. A not done Charge on a closed Visit (never off stock) comes
   * back not done; on the Job itself, an Item not done comes back planned
   * and any other cost done.
   */
  async down() {
    this.schema.raw(
      `DELETE FROM charge_events WHERE kind IN (${WORK_KINDS.map((kind) => `'${kind}'`).join(', ')})`
    )
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck(OLD_KINDS))
  }
}
