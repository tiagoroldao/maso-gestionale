import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import Job from '#models/job'
import Visit from '#models/visit'
import LabourRate from '#models/labour_rate'
import User from '#models/user'
import Charges, { ChargeRefusedError } from '#services/charges'
import Installations from '#services/installations'
import { localDateTime } from '#services/dates'
import StockLedger from '#stock/stock_ledger'
import { flashWithStockWarning } from '#stock/stock_warning'
import { isClosedVisit } from '#shared/visits'
import {
  chargeBillingValidator,
  itemCorrectionValidator,
  jobChargeValidator,
  labourCorrectionValidator,
  otherCorrectionValidator,
} from '#validators/charge'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Office's review of a Charge (ADR 0010): adding other costs to a Job,
 * correcting what was recorded, editing what is billed, marking it not
 * billable, setting it back to bill, and its history.
 */
export default class ChargesController {
  async store({ params, request, response, session, auth, i18n }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    const data = await request.validateUsing(jobChargeValidator)

    try {
      await Charges.add(job, { ...data, unit: data.unit ?? null }, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.chargeAdded'))
    } catch (error) {
      if (!(error instanceof ChargeRefusedError)) throw error
      session.flash('error', i18n.t(`flash.chargeRefused.${error.reason}`))
    }
    return response.redirect().toRoute('jobs.show', { id: job.id })
  }

  async edit({ params, inertia }: HttpContext) {
    const charge = await Charge.query()
      .where('id', params.id)
      .preload('events', (events) => events.preload('user').preload('invoice').orderBy('id'))
      .preload('invoiceLines', (lines) => lines.preload('invoice'))
      .preload('item')
      .preload('labourRate')
      .preload('technician')
      .firstOrFail()
    const invoice = charge.heldBy ?? charge.billing?.invoice ?? null
    const job = await Job.findOrFail(charge.jobId)
    const visit = charge.visitId ? await Visit.findOrFail(charge.visitId) : null
    const frozen = await Charges.isFrozen(charge.id)

    // Archived rates only for the Charge already using one
    const rates = await LabourRate.query()
      .where((query) => query.whereNull('archivedAt').orWhere('id', charge.labourRateId ?? 0))
      .orderBy('name')
    // Active Technicians on the Visit, and whoever the Charge already names
    const technicians = await User.query()
      .where((query) => {
        query
          .where((active) => {
            active.where('role', 'technician').where('isActive', true)
            if (visit) {
              active.whereIn(
                'id',
                db.from('visit_technicians').where('visit_id', visit.id).select('user_id')
              )
            }
          })
          .orWhere('id', charge.userId ?? 0)
      })
      .orderBy('email')

    return inertia.render('charges/edit', {
      charge: {
        id: charge.id,
        kind: charge.kind,
        state: charge.state,
        workState: charge.workState,
        // Office switches done and not done once the Visit closed (a Job's
        // own Charges at any time), while no draft holds it and no issued
        // Invoice bills it uncredited (ADR 0016)
        canSetWork:
          (!visit || isClosedVisit(visit.status)) && charge.state !== 'in_draft' && !frozen,
        // Its quantity and Item are frozen too
        frozen,
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
          unit: charge.billUnit,
          vatKind: charge.vatKind,
        },
        // The draft holding it, or the Invoice billing it
        invoice: invoice ? { id: invoice.id, number: invoice.formattedNumber } : null,
        history: charge.events.map((event) => ({
          id: event.id,
          kind: event.kind,
          at: localDateTime(event.createdAt),
          user: event.user ? (event.user.fullName ?? event.user.email) : null,
          changes: event.changes,
          invoice: event.invoice
            ? { id: event.invoice.id, number: event.invoice.formattedNumber }
            : null,
          amount: event.amount,
        })),
      },
      job: {
        id: job.id,
        number: job.number,
        title: job.title,
      },
      labourRates: rates.map((rate) => ({ id: rate.id, name: rate.name })),
      technicians: technicians.map((user) => ({ id: user.id, name: user.fullName ?? user.email })),
    })
  }

  async correct({ params, request, response, session, auth, i18n }: HttpContext) {
    const charge = await Charge.findOrFail(params.id)
    const data =
      charge.kind === 'labour'
        ? await request.validateUsing(labourCorrectionValidator)
        : charge.kind === 'item'
          ? await request.validateUsing(itemCorrectionValidator)
          : await request.validateUsing(otherCorrectionValidator)

    // More of an Item, or another one, may leave it short
    const itemIds = 'itemId' in data && typeof data.itemId === 'number' ? [data.itemId] : []
    const before = await StockLedger.quantities(itemIds)

    return this.refusable(charge, { response, session, i18n }, async () => {
      const left = await Charges.correct(
        charge,
        data,
        auth.getUserOrFail(),
        i18n.t('ui.charges.stockCorrection', { id: charge.id })
      )
      await flashWithStockWarning(
        { session, i18n },
        itemIds,
        i18n.t('flash.chargeCorrected'),
        before,
        Installations.messages(i18n, left)
      )
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
   * Sets a billed Charge back to "to bill", to bill it again by hand.
   */
  async setBackToBill({ params, response, session, auth, i18n }: HttpContext) {
    const charge = await Charge.findOrFail(params.id)
    return this.refusable(charge, { response, session, i18n }, async () => {
      await Charges.setBackToBill(charge, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.chargeSetBackToBill'))
    })
  }

  /**
   * Marks the Charge done (on the Job, confirming planned work used) or
   * not done (ADR 0016), back on the page it was done from: the Charge's,
   * or the Job's.
   */
  async markDone(ctx: HttpContext) {
    return this.setWorkState(ctx, 'done')
  }

  async markNotDone(ctx: HttpContext) {
    return this.setWorkState(ctx, 'not_done')
  }

  private async setWorkState(
    { params, response, session, auth, i18n }: HttpContext,
    work: 'done' | 'not_done'
  ) {
    const charge = await Charge.findOrFail(params.id)
    // A not done Item becoming done leaves stock, which may leave it short
    const itemIds = charge.itemId ? [charge.itemId] : []
    const before = await StockLedger.quantities(itemIds)
    return this.refusable(
      charge,
      { response, session, i18n },
      async () => {
        const warnings = await Charges.setWorkState(
          charge,
          work,
          auth.getUserOrFail(),
          i18n.t('ui.charges.stockNotDone', { id: charge.id })
        )
        await flashWithStockWarning(
          { session, i18n },
          itemIds,
          i18n.t(`flash.chargeWork.${work}`),
          before,
          Installations.messages(i18n, warnings)
        )
      },
      true
    )
  }

  /**
   * Runs `work`, turning a refusal into a message on the Charge's page (or
   * the page the request came from).
   */
  private async refusable(
    charge: Charge,
    { response, session, i18n }: Pick<HttpContext, 'response' | 'session' | 'i18n'>,
    work: () => Promise<unknown>,
    back = false
  ) {
    try {
      await work()
    } catch (error) {
      if (!(error instanceof ChargeRefusedError)) throw error
      session.flash('error', i18n.t(`flash.chargeRefused.${error.reason}`))
    }
    if (back) return response.redirect().back()
    return response.redirect().toRoute('charges.edit', { id: charge.id })
  }
}
