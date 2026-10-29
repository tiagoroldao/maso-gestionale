import Big from 'big.js'
import type { WorkState } from '#shared/charges'
import { isCancelledVisit, isClosedVisit, isOpenVisit } from '#shared/visits'

/**
 * The Job page's summary for Jobs with many Visits (#178): how far the
 * Visits have got, and the hours and Items recorded across the Visits and
 * the Job itself, by work state (ADR 0016).
 */

/**
 * Quantities by work state: planned, done (used) and not done.
 */
export type WorkTotals = { planned: string; done: string; notDone: string }

/**
 * Where the work stands on the Job's Visits: how many are done (closed,
 * "needs another visit" included) of those not cancelled, how many were
 * cancelled (they don't count as work, ADR 0016), and the earliest Visit
 * still to happen or under way, if any, while the Job takes new work: on a
 * closed or cancelled Job an open Visit is frozen and won't happen (ADR
 * 0015). `startsAt` is a local date-time ("2026-11-06T09:00"), so they
 * sort as text.
 */
export function visitProgress<V extends { status: string; startsAt: string }>(
  visits: V[],
  jobActive: boolean
) {
  const counted = visits.filter((visit) => !isCancelledVisit(visit.status))
  const open = visits
    .filter((visit) => isOpenVisit(visit.status))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return {
    done: counted.filter((visit) => isClosedVisit(visit.status)).length,
    total: counted.length,
    cancelled: visits.length - counted.length,
    next: jobActive ? (open[0] ?? null) : null,
  }
}

/**
 * A Charge as the summary reads it: its recorded quantity (what feeds stock
 * and history, ADR 0010) and its work state. A cancelled Visit's Charges
 * are not done (#157).
 */
export type SummaryCharge = {
  visitId: number | null
  quantity: string
  work: WorkState
} & (
  | {
      kind: 'labour'
      // The Technician, or the person outside the app by name
      technicianId: number | null
      worker: string | null
      labourRateId: number | null
      labourRate: string | null
    }
  | { kind: 'item'; itemId: number; item: string; unit: string | null }
  | { kind: 'other' }
)

type Breakdown = WorkTotals & { visitId: number | null }

class Totals {
  planned = new Big(0)
  done = new Big(0)
  notDone = new Big(0)

  add(work: WorkState, quantity: string) {
    const key = work === 'not_done' ? 'notDone' : work
    this[key] = this[key].plus(quantity)
  }

  toJSON(): WorkTotals {
    return {
      planned: this.planned.toString(),
      done: this.done.toString(),
      notDone: this.notDone.toString(),
    }
  }
}

/**
 * A summary row: its totals, and the same per Visit (null for the Job
 * itself), the Job first, then the Visits in `visitIds`' order.
 */
class Row {
  totals = new Totals()
  visits = new Map<number | null, Totals>()

  add(charge: SummaryCharge) {
    this.totals.add(charge.work, charge.quantity)
    const visit = this.visits.get(charge.visitId) ?? new Totals()
    visit.add(charge.work, charge.quantity)
    this.visits.set(charge.visitId, visit)
  }

  toJSON(visitIds: number[]): WorkTotals & { visits: Breakdown[] } {
    const order = (id: number | null) => (id === null ? -1 : visitIds.indexOf(id))
    return {
      ...this.totals.toJSON(),
      visits: [...this.visits.entries()]
        .sort(([a], [b]) => order(a) - order(b))
        .map(([visitId, totals]) => ({ visitId, ...totals.toJSON() })),
    }
  }
}

/**
 * The Charges summary across the Job's Visits and the Job itself (#178):
 * hours per Technician (or the person outside the app) and Labour Rate,
 * and quantities per Item, each planned, done and not done, with the
 * Visits behind them. It is how Office reconciles material planned on the
 * Job against what was used on each Visit. Other costs aren't summarised.
 * Rows come in the order of their first Charge; hours rows carry a `key`
 * telling apart two people of the same name.
 */
export function chargeSummary(charges: SummaryCharge[], visitIds: number[]) {
  const hours = new Map<
    string,
    { key: string; worker: string | null; labourRate: string | null; unit: 'h'; row: Row }
  >()
  const items = new Map<number, { item: string; unit: string | null; row: Row }>()
  for (const charge of charges) {
    if (charge.kind === 'labour') {
      const key = JSON.stringify([charge.technicianId ?? charge.worker, charge.labourRateId])
      const entry = hours.get(key) ?? {
        key,
        worker: charge.worker,
        labourRate: charge.labourRate,
        unit: 'h' as const,
        row: new Row(),
      }
      entry.row.add(charge)
      hours.set(key, entry)
    } else if (charge.kind === 'item') {
      const entry = items.get(charge.itemId) ?? {
        item: charge.item,
        unit: charge.unit,
        row: new Row(),
      }
      entry.row.add(charge)
      items.set(charge.itemId, entry)
    }
  }
  return {
    hours: [...hours.values()].map(({ row, ...rest }) => ({ ...rest, ...row.toJSON(visitIds) })),
    items: [...items.entries()].map(([itemId, { row, ...rest }]) => ({
      itemId,
      ...rest,
      ...row.toJSON(visitIds),
    })),
  }
}
