import type { I18n } from '@adonisjs/i18n'
import type Charge from '#models/charge'
import type Job from '#models/job'
import Visit from '#models/visit'
import { formatDate } from '#shared/dates'
import type { TableData } from '#shared/document_templates'
import { lineTotal } from '#shared/money'
import { CLOSED_VISIT_STATUSES } from '#shared/visits'
import {
  inPeriod,
  workReportTable,
  type WorkReportCharge,
  type WorkReportLabels,
  type WorkReportOptions,
  type WorkReportVisit,
} from '#shared/work_report'

/**
 * A Job's work report (#180), for a work report field of a Document
 * Template: its closed Visits whose work day (#174) falls in the period,
 * each with who worked on it, its done hours and Items (ADR 0016: planned
 * and not done work isn't reported), and its field notes. Charges on the
 * Job itself belong to no day and aren't reported, nor are other costs.
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
   * The report as the document prints it: its table, and its period in
   * words.
   */
  static async resolve(
    job: Job,
    options: WorkReportOptions,
    i18n: I18n
  ): Promise<{ table: TableData; period: string }> {
    const visits = await this.visits(job, options)
    return {
      table: workReportTable(visits, options, this.labels(i18n)),
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
      total: label('total'),
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
 * an Item under its description; its recorded and billed quantities (ADR
 * 0010), and what it bills, as the Job page counts it: nothing when not
 * billable or credited.
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
  return {
    ...common,
    group: `labour:${charge.labourRateId ?? charge.description}`,
    description: charge.labourRate?.name ?? charge.description,
    unit: 'h',
  }
}
