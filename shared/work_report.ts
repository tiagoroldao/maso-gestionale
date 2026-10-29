/**
 * The work report (_rapportino_) of a Job (#180): a day-by-day account of
 * its Visits, printed by a Document Template's work report field as a
 * table, so it is issued, numbered and frozen like any Issued Document.
 * Pure: the server fills it, the editor's preview shows a sample.
 */
import Big from 'big.js'
import { formatDate } from './dates.js'
import { formatMoney, sumAmounts } from './money.js'
import type { TableData } from './document_templates.js'

/**
 * What Office chooses when issuing: the period (either end open, both
 * open for the whole Job, as ISO dates), whether prices and the Visits'
 * notes show, and whether the Job's other costs follow the days (#192, on
 * unless Office leaves them out, e.g. for a timesheet only).
 */
export type WorkReportOptions = {
  from: string | null
  to: string | null
  prices: boolean
  notes: boolean
  jobCharges: boolean
}

export const WHOLE_JOB_REPORT: WorkReportOptions = {
  from: null,
  to: null,
  prices: false,
  notes: false,
  jobCharges: true,
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/**
 * The options as filled in, or null when they aren't options: dates as
 * ISO days (empty for an open end), the choices as booleans, every one
 * given. Only a report already `issued` may lack `jobCharges`: one issued
 * before #192 printed no other costs, so its replacement starts without
 * them too.
 */
export function parseWorkReportOptions(
  value: unknown,
  { issued = false } = {}
): WorkReportOptions | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  const { from, to, prices, notes } = fields
  const jobCharges = issued && !('jobCharges' in fields) ? false : fields.jobCharges
  const day = (end: unknown) =>
    end === null || end === undefined || end === ''
      ? null
      : typeof end === 'string' && isIsoDate(end)
        ? end
        : undefined
  const [start, finish] = [day(from), day(to)]
  if (start === undefined || finish === undefined) return null
  if ([prices, notes, jobCharges].some((choice) => typeof choice !== 'boolean')) return null
  return {
    from: start,
    to: finish,
    prices: prices as boolean,
    notes: notes as boolean,
    jobCharges: jobCharges as boolean,
  }
}

/**
 * Hours at a Labour Rate, an Item used or another cost, as a done Charge
 * has them (ADR 0010, 0016): `group` tells apart Labour Rates, Items and
 * other costs of the same name; `quantity` is what was recorded, `billQuantity` what Office set to
 * bill; `amount` is what it bills, null when it isn't billed (not
 * billable, or credited).
 */
export type WorkReportCharge = {
  group: string
  description: string
  unit: string
  quantity: string
  billQuantity: string
  unitPrice: string
  amount: string | null
}

/**
 * A closed Visit as the report prints it: its work day (ISO), who worked
 * on it, its done hours and Items, and its notes.
 */
export type WorkReportVisit = {
  day: string
  technicians: string[]
  charges: WorkReportCharge[]
  notes: string[]
}

/**
 * The report's content: its days, and the Job's own done Charges, on no
 * Visit (#192).
 */
export type WorkReport = {
  visits: WorkReportVisit[]
  jobCharges: WorkReportCharge[]
}

/**
 * The printed words, from the catalogue: `total` for everything billed,
 * `visitsTotal` when the Job's other costs are left out, so it isn't
 * taken for the Invoice's total.
 */
export type WorkReportLabels = {
  date: string
  technicians: string
  description: string
  quantity: string
  unitPrice: string
  amount: string
  notes: string
  notBilled: string
  jobCharges: string
  total: string
  visitsTotal: string
}

const quantityFormat = new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 3,
  useGrouping: false,
})

type Line = WorkReportCharge & { amounts: (string | null)[] }

/**
 * A Visit's Charges, or the Job's own (#192), as lines, in the order first
 * recorded: hours summed per Labour Rate (whoever worked them), quantities
 * per Item, and other costs per description and unit, recorded and billed
 * alike; with prices, also apart by unit price and whether they bill.
 */
function linesOf(charges: WorkReportCharge[], prices: boolean): Line[] {
  const lines = new Map<string, Line>()
  for (const charge of charges) {
    const key = JSON.stringify(
      prices ? [charge.group, charge.unitPrice, charge.amount === null] : [charge.group]
    )
    const line = lines.get(key)
    if (line) {
      line.quantity = new Big(line.quantity).plus(charge.quantity).toString()
      line.billQuantity = new Big(line.billQuantity).plus(charge.billQuantity).toString()
      line.amounts.push(charge.amount)
    } else {
      lines.set(key, { ...charge, amounts: [charge.amount] })
    }
  }
  return [...lines.values()]
}

/**
 * The report as a table: a row per line of each Visit, the Visit's day
 * and Technicians on its first, then its notes when chosen; then, when
 * chosen, the Job's other costs under their own heading (#192). Without
 * prices, a line's quantity is what was recorded; with prices, it is what
 * is billed, with its unit price and amount (before VAT), so quantity ×
 * price gives the amount, and the total billed comes at the end. A line's
 * amount is what its Charges bill (ADR 0010), so it can differ from
 * quantity × price by per-Charge rounding, or when an Invoice line billed
 * less.
 */
export function workReportTable(
  report: WorkReport,
  options: Pick<WorkReportOptions, 'prices' | 'notes' | 'jobCharges'>,
  labels: WorkReportLabels
): TableData {
  const headers = [labels.date, labels.technicians, labels.description, labels.quantity]
  if (options.prices) headers.push(labels.unitPrice, labels.amount)
  const blank = () => headers.map(() => '')
  const rows: string[][] = []
  const billed: string[] = []
  const linesAsRows = (charges: WorkReportCharge[]) =>
    linesOf(charges, options.prices).map((line) => {
      const row = blank()
      row[2] = line.description
      const quantity = options.prices ? line.billQuantity : line.quantity
      row[3] = `${quantityFormat.format(Number(quantity))} ${line.unit}`.trim()
      if (options.prices) {
        const amounts = line.amounts.filter((amount): amount is string => amount !== null)
        row[4] = formatMoney(line.unitPrice)
        row[5] = amounts.length ? formatMoney(sumAmounts(amounts)) : labels.notBilled
        billed.push(...amounts)
      }
      return row
    })

  for (const visit of report.visits) {
    const visitRows = linesAsRows(visit.charges)
    if (options.notes && visit.notes.length) {
      const row = blank()
      row[2] = `${labels.notes}: ${visit.notes.join(' / ')}`
      visitRows.push(row)
    }
    if (visitRows.length === 0) visitRows.push(blank())
    visitRows[0][0] = formatDate(visit.day)
    visitRows[0][1] = visit.technicians.join(', ')
    rows.push(...visitRows)
  }

  if (options.jobCharges && report.jobCharges.length) {
    const heading = blank()
    heading[2] = labels.jobCharges
    rows.push(heading, ...linesAsRows(report.jobCharges))
  }

  if (options.prices) {
    const row = blank()
    row[2] = options.jobCharges ? labels.total : labels.visitsTotal
    row[5] = formatMoney(sumAmounts(billed))
    rows.push(row)
  }
  return { headers, rows }
}

/**
 * Whether a day falls in the period (ends included): a Visit's work day,
 * or the day a Job Charge became done (#192).
 */
export function inPeriod(day: string, options: Pick<WorkReportOptions, 'from' | 'to'>) {
  return (!options.from || day >= options.from) && (!options.to || day <= options.to)
}

/**
 * A sample report for the editor's preview.
 */
export function sampleWorkReport(labels: WorkReportLabels, today: string): TableData {
  const charge = (description: string, unit: string, quantity: string, unitPrice: string) => ({
    group: description,
    description,
    unit,
    quantity,
    billQuantity: quantity,
    unitPrice,
    amount: new Big(quantity).times(unitPrice).toFixed(2),
  })
  return workReportTable(
    {
      visits: [
        {
          day: today,
          technicians: ['Mario Bianchi', 'Luca Verdi'],
          charges: [
            charge('Manodopera ordinaria', 'h', '6', '40'),
            charge('Valvola a sfera 1/2"', 'pz', '2', '8.5'),
          ],
          notes: ['Sostituita la valvola di intercettazione.'],
        },
      ],
      jobCharges: [charge('Diritto di chiamata', '', '1', '30')],
    },
    { prices: true, notes: true, jobCharges: true },
    labels
  )
}
