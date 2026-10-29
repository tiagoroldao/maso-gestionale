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
 *   done (closing always took done Items off stock);
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
 * Where down() keeps the work events it takes out of the history, for up()
 * to put back.
 */
const KEPT = 'charge_work_events_kept'
const WORK_KINDS_SQL = WORK_KINDS.map((kind) => `'${kind}'`).join(', ')

/**
 * Takes the work events out of the Charges' history, keeping them in
 * their order, with a "planned" one for each Charge planned without any
 * (down).
 */
export async function keepWorkEvents(db: Pick<QueryClientContract, 'rawQuery'>) {
  await db.rawQuery(`CREATE TABLE IF NOT EXISTS ${KEPT} (
    id serial PRIMARY KEY,
    charge_id integer NOT NULL,
    kind varchar(20) NOT NULL,
    user_id integer,
    created_at timestamptz NOT NULL)`)
  await db.rawQuery(`INSERT INTO ${KEPT} (charge_id, kind, user_id, created_at)
    SELECT charge_id, kind, user_id, created_at FROM charge_events
    WHERE kind IN (${WORK_KINDS_SQL}) ORDER BY id`)
  await db.rawQuery(`INSERT INTO ${KEPT} (charge_id, kind, user_id, created_at)
    SELECT c.id, 'planned', NULL, now() FROM charges c
    WHERE NOT EXISTS (SELECT 1 FROM charge_events e
      WHERE e.charge_id = c.id AND e.kind IN (${WORK_KINDS_SQL}))
    ORDER BY c.id`)
  await db.rawQuery(`DELETE FROM charge_events WHERE kind IN (${WORK_KINDS_SQL})`)
}

/**
 * Puts back the work events down() kept, in their order, for the Charges
 * still there. One left planned whose Visit closed since, or that an
 * Invoice billed or a draft took since, is worked out again by
 * migrateWorkStates() instead (up).
 */
export async function restoreWorkEvents(db: Pick<QueryClientContract, 'rawQuery'>) {
  const found = await db.rawQuery(`SELECT to_regclass('${KEPT}') AS kept`)
  if (!found.rows[0].kept) return
  await db.rawQuery(`INSERT INTO charge_events (charge_id, kind, user_id, created_at)
    SELECT k.charge_id, k.kind, (SELECT u.id FROM users u WHERE u.id = k.user_id), k.created_at
    FROM ${KEPT} k
    JOIN charges c ON c.id = k.charge_id
    LEFT JOIN visits v ON v.id = c.visit_id
    WHERE (SELECT l.kind FROM ${KEPT} l WHERE l.charge_id = k.charge_id
        ORDER BY l.id DESC LIMIT 1) <> 'planned'
      OR (coalesce(v.status NOT IN ('done', 'needs_return'), true)
        AND NOT EXISTS (SELECT 1 FROM charge_events e
          WHERE e.charge_id = c.id AND e.kind = 'billed')
        AND NOT EXISTS (SELECT 1 FROM invoice_line_charges lc WHERE lc.charge_id = c.id))
    ORDER BY k.id`)
  await db.rawQuery(`DROP TABLE ${KEPT}`)
}

/**
 * Charges have a work state (#156, ADR 0016): planned, done or not done,
 * kept as "planned", "done" and "not done" events in their history.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck([...OLD_KINDS, ...WORK_KINDS]))
    this.defer(async (db) => {
      await restoreWorkEvents(db)
      await migrateWorkStates(db)
    })
  }

  /**
   * Takes the work events out of the history, keeping them aside so that
   * migrating up again puts them back (keepWorkEvents). Stock Movements
   * stay as they are: they record what left the Warehouse, and every
   * Charge's link to its usage stays, so a Charge back done isn't taken
   * off stock twice and one back not done isn't taken off at all.
   */
  async down() {
    this.defer((db) => keepWorkEvents(db))
    this.schema.raw('ALTER TABLE charge_events DROP CONSTRAINT charge_events_kind_check')
    this.schema.raw(kindCheck(OLD_KINDS))
  }
}
