import type { I18n } from '@adonisjs/i18n'
import Charge from '#models/charge'
import type Job from '#models/job'
import Visit from '#models/visit'
import { formatDate, todayIso } from '#shared/dates'
import type { TableData } from '#shared/document_templates'
import { lineTotal } from '#shared/money'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'
import { WORK_STATE_SQL } from '#services/job_status'
import {
  inPeriod,
  workReportTable,
  type WorkReport,
  type WorkReportCharge,
  type WorkReportLabels,
  type WorkReportOptions,
  type WorkReportVisit,
} from '#shared/work_report'

/**
 * A Job's work report (#180), for a work report field of a Document
 * Template: its closed Visits whose work day (#174) falls in the period,
 * each with who worked on it, its done hours and Items (ADR 0016: planned
 * and not done work isn't reported), and its field notes; then, unless
 * Office leaves them out, the Job's own done Charges, on no Visit (#192).
 */
export default class WorkReports {
  static async visits(job: Job, period: Pick<WorkReportOptions, 'from' | 'to'>) {
    const visits = await Visit.query()
      .where('jobId', job.id)
      .whereIn('status', [...CLOSED_VISIT_STATUSES])
      .preload('technicians')
      .preload('fieldNotes', (notes) => notes.orderBy(['createdAt', 'id']))
      .preload('charges', (charges) =>
        charges
          .whereIn('kind', ['labour', 'item'])
          .preload('events', (events) => events.orderBy('id'))
          .preload('invoiceLines', (lines) => lines.preload('invoice'))
          .preload('technician')
          .preload('labourRate')
          .preload('item')
          .orderBy('id')
      )
      .orderBy(['startsAt', 'id'])

    return visits
      .map((visit) => ({ visit, day: visit.workDay().toISODate()! }))
      .filter(({ day }) => inPeriod(day, period))
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(({ visit, day }): WorkReportVisit => {
        const done = visit.charges.filter((charge) => charge.workState === 'done')
        const names = visit.technicians
          .map((technician) => technician.fullName ?? technician.email)
          .sort((a, b) => a.localeCompare(b))
        // Whoever recorded hours, assigned or not (a contractor by name)
        for (const charge of done) {
          if (charge.worker && !names.includes(charge.worker)) names.push(charge.worker)
        }
        return {
          day,
          technicians: names,
          charges: done.map((charge) => reported(charge)),
          notes: visit.fieldNotes.map((note) => note.body),
        }
      })
  }

  /**
   * The Job's own done Charges, on no Visit (#192): hours, Items and other
   * costs Office recorded, and those imported from a Quote once confirmed
   * used. They belong to no work day, so a period takes those that became
   * done in it: the day (Europe/Rome) of their latest "done" event.
   */
  static async jobCharges(job: Job, period: Pick<WorkReportOptions, 'from' | 'to'>) {
    const charges = await Charge.query()
      .where('jobId', job.id)
      .whereNull('visitId')
      .whereRaw(`${WORK_STATE_SQL('charges')} = 'done'`)
      .preload('events', (events) => events.orderBy('id'))
      .preload('invoiceLines', (lines) => lines.preload('invoice'))
      .preload('technician')
      .preload('labourRate')
      .preload('item')
      .orderBy('id')

    return charges
      .filter((charge) => {
        const done = charge.events.findLast((event) => event.kind === 'done')!
        return inPeriod(todayIso(done.createdAt.toJSDate()), period)
      })
      .map((charge) => reported(charge))
  }

  /**
   * The report as the document prints it: its table, and its period in
   * words.
   */
  static async resolve(
    job: Job,
    options: WorkReportOptions,
    i18n: I18n
  ): Promise<{ table: TableData; period: string }> {
    const report: WorkReport = {
      visits: await this.visits(job, options),
      jobCharges: options.jobCharges ? await this.jobCharges(job, options) : [],
    }
    return {
      table: workReportTable(report, options, this.labels(i18n)),
      period: this.period(options, i18n),
    }
  }

  static labels(i18n: I18n): WorkReportLabels {
    const label = (key: keyof WorkReportLabels) => i18n.t(`documents.workReport.${key}`)
    return {
      date: label('date'),
      technicians: label('technicians'),
      description: label('description'),
      quantity: label('quantity'),
      unitPrice: label('unitPrice'),
      amount: label('amount'),
      notes: label('notes'),
      notBilled: label('notBilled'),
      jobCharges: label('jobCharges'),
      total: label('total'),
      visitsTotal: label('visitsTotal'),
    }
  }

  static period(options: Pick<WorkReportOptions, 'from' | 'to'>, i18n: I18n) {
    const from = formatDate(options.from)
    const to = formatDate(options.to)
    if (options.from && options.to) return i18n.t('documents.workReport.between', { from, to })
    if (options.from) return i18n.t('documents.workReport.since', { from })
    if (options.to) return i18n.t('documents.workReport.until', { to })
    return i18n.t('documents.workReport.wholeJob')
  }
}

/**
 * A done Charge as the report lists it: hours under their Labour Rate,
 * an Item under its description, another cost under its own description
 * and unit; its recorded and billed quantities (ADR 0010), and what it
 * bills, as the Job page counts it: nothing when not billable or credited.
 */
function reported(charge: Charge): WorkReportCharge {
  const unbilled = charge.state === 'not_billable' || charge.state === 'credited'
  const amount = unbilled
    ? null
    : (charge.billing?.amount ?? lineTotal(charge.billQuantity, charge.unitPrice))
  const common = {
    quantity: charge.quantity,
    billQuantity: charge.billQuantity,
    unitPrice: charge.unitPrice,
    amount,
  }
  if (charge.kind === 'item') {
    return {
      ...common,
      group: `item:${charge.itemId}`,
      description: charge.item.description,
      unit: charge.item.unit,
    }
  }
  if (charge.kind === 'other') {
    return {
      ...common,
      group: `other:${JSON.stringify([charge.description, charge.unit])}`,
      description: charge.description,
      unit: charge.unit ?? '',
    }
  }
  return {
    ...common,
    group: `labour:${charge.labourRateId ?? charge.description}`,
    description: charge.labourRate?.name ?? charge.description,
    unit: 'h',
  }
}
