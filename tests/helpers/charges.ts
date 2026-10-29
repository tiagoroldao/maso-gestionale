import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import type User from '#models/user'
import Charges from '#services/charges'
import { CHARGE_STATE_SQL, WORK_STATE_SQL } from '#services/job_status'
import { createUser } from '#tests/helpers/users'

/**
 * Office confirms used every Charge on the Job itself (imported from a
 * Quote, planned until then; ADR 0016).
 */
export async function confirmUsed(jobId: number, user?: User) {
  const office = user ?? (await createUser('office'))
  const charges = await Charge.query().where('jobId', jobId).whereNull('visitId').orderBy('id')
  for (const charge of charges) {
    await Charges.setWorkState(charge, 'done', office, 'Usato')
  }
}

/**
 * The Charge's work state as the pages show it (workState()) and as SQL
 * reads it (WORK_STATE_SQL), which must agree.
 */
export async function workStatesOf(charge: Charge) {
  const loaded = await Charge.query()
    .where('id', charge.id)
    .preload('events', (events) => events.orderBy('id'))
    .firstOrFail()
  const row = await db
    .from('charges')
    .where('id', charge.id)
    .select(db.raw(`${WORK_STATE_SQL('charges')} AS work`))
    .firstOrFail()
  return { ts: loaded.workState, sql: row.work as string }
}

/**
 * The Charge's state as the pages show it (chargeState()).
 */
export async function stateOf(charge: Charge) {
  const loaded = await Charge.query()
    .where('id', charge.id)
    .preload('events', (events) => events.orderBy('id'))
    .preload('invoiceLines', (lines) => lines.preload('invoice'))
    .firstOrFail()
  return loaded.state
}

/**
 * The Charge's state as list filters read it (CHARGE_STATE_SQL).
 */
export async function sqlStateOf(charge: Charge) {
  const row = await db
    .from('charges')
    .where('id', charge.id)
    .select(db.raw(`${CHARGE_STATE_SQL('charges')} AS state`))
    .firstOrFail()
  return row.state as string
}

/**
 * The kinds of the Charge's events, oldest first.
 */
export async function history(charge: Charge) {
  const events = await ChargeEvent.query().where('chargeId', charge.id).orderBy('id')
  return events.map((event) => event.kind)
}
