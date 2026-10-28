import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import { CHARGE_STATE_SQL } from '#services/job_status'

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
