import Charge from '#models/charge'
import Job from '#models/job'
import Visit from '#models/visit'
import LabourRate from '#models/labour_rate'
import User from '#models/user'
import Charges, { ChargeRefusedError } from '#services/charges'
import { localDateTime } from '#services/dates'
import {
  chargeBillingValidator,
  itemCorrectionValidator,
  labourCorrectionValidator,
} from '#validators/charge'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Office's review of a Charge (ADR 0010): correcting what was recorded,
 * editing what is billed, marking it not billable, and its history.
 */
export default class ChargesController {
  async edit({ params, inertia }: HttpContext) {
    const charge = await Charge.query()
      .where('id', params.id)
      .preload('events', (events) => events.preload('user').orderBy('id'))
      .preload('invoice')
      .preload('item')
      .preload('labourRate')
      .preload('technician')
      .firstOrFail()
    const job = await Job.findOrFail(charge.jobId)
    const visit = charge.visitId ? await Visit.findOrFail(charge.visitId) : null

    // Archived rates only for the Charge already using one
    const rates = await LabourRate.query()
      .where((query) => query.whereNull('archivedAt').orWhere('id', charge.labourRateId ?? 0))
      .orderBy('name')
    const technicians = await User.query()
      .where('role', 'technician')
      .where((query) => query.where('isActive', true).orWhere('id', charge.userId ?? 0))
      .orderBy('email')

    return inertia.render('charges/edit', {
      charge: {
        id: charge.id,
        kind: charge.kind,
        state: charge.state,
        visitStartsAt: visit ? localDateTime(visit.startsAt) : null,
        recorded: {
          quantity: charge.quantity,
          labourRateId: charge.labourRateId,
          technicianId: charge.userId,
          workerName: charge.workerName,
          item: charge.item
            ? {
                id: charge.item.id,
                code: charge.item.code,
                description: charge.item.description,
                unit: charge.item.unit,
              }
            : null,
        },
        billing: {
          quantity: charge.billQuantity,
          unitPrice: charge.unitPrice,
          description: charge.description,
          unit: charge.unit,
        },
        invoice: charge.invoice
          ? { id: charge.invoice.id, number: charge.invoice.formattedNumber }
          : null,
        history: charge.events.map((event) => ({
          id: event.id,
          kind: event.kind,
          at: localDateTime(event.createdAt),
          user: event.user ? (event.user.fullName ?? event.user.email) : null,
          changes: event.changes,
        })),
      },
      job: { id: job.id, number: job.number, title: job.title },
      labourRates: rates.map((rate) => ({ id: rate.id, name: rate.name })),
      technicians: technicians.map((user) => ({ id: user.id, name: user.fullName ?? user.email })),
    })
  }

  async correct({ params, request, response, session, auth, i18n }: HttpContext) {
    const charge = await Charge.findOrFail(params.id)
    const data =
      charge.kind === 'labour'
        ? await request.validateUsing(labourCorrectionValidator)
        : await request.validateUsing(itemCorrectionValidator)

    return this.refusable(charge, { response, session, i18n }, async () => {
      await Charges.correct(
        charge,
        data,
        auth.getUserOrFail(),
        i18n.t('ui.charges.stockCorrection', { id: charge.id })
      )
      session.flash('success', i18n.t('flash.chargeCorrected'))
    })
  }

  async updateBilling({ params, request, response, session, auth, i18n }: HttpContext) {
    const charge = await Charge.findOrFail(params.id)
    const data = await request.validateUsing(chargeBillingValidator)

    return this.refusable(charge, { response, session, i18n }, async () => {
      await Charges.editBilling(charge, data, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.chargeBillingSaved'))
    })
  }

  async markNotBillable({ params, response, session, auth, i18n }: HttpContext) {
    const charge = await Charge.findOrFail(params.id)
    return this.refusable(charge, { response, session, i18n }, async () => {
      await Charges.setBillable(charge, false, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.chargeNotBillable'))
    })
  }

  async markBillable({ params, response, session, auth, i18n }: HttpContext) {
    const charge = await Charge.findOrFail(params.id)
    return this.refusable(charge, { response, session, i18n }, async () => {
      await Charges.setBillable(charge, true, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.chargeBillable'))
    })
  }

  /**
   * Runs `work`, turning a refusal into a message on the Charge's page.
   */
  private async refusable(
    charge: Charge,
    { response, session, i18n }: Pick<HttpContext, 'response' | 'session' | 'i18n'>,
    work: () => Promise<unknown>
  ) {
    try {
      await work()
    } catch (error) {
      if (!(error instanceof ChargeRefusedError)) throw error
      session.flash('error', i18n.t(`flash.chargeRefused.${error.reason}`))
    }
    return response.redirect().toRoute('charges.edit', { id: charge.id })
  }
}
