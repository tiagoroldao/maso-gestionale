import { DateTime } from 'luxon'
import LabourRate from '#models/labour_rate'
import CompanySettings from '#models/company_settings'
import { isUniqueViolation } from '#services/database_errors'
import { callOutFeeValidator, labourRateValidator } from '#validators/quote'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The Admin's Labour Rates and Call-out Fee (Settings → Tariffe).
 */
export default class RatesController {
  async index({ inertia }: HttpContext) {
    const rates = await LabourRate.query().whereNull('archived_at').orderBy('name')
    const settings = await CompanySettings.current()

    return inertia.render('settings/rates', {
      labourRates: rates.map((rate) => ({
        id: rate.id,
        name: rate.name,
        hourlyPrice: rate.hourlyPrice,
      })),
      callOutFee: settings.callOutFee ?? null,
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(labourRateValidator, { meta: {} })
    try {
      await LabourRate.create(data)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().toRoute('rates.index')
    }

    session.flash('success', i18n.t('flash.labourRateAdded'))
    response.redirect().toRoute('rates.index')
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const rate = await LabourRate.findOrFail(params.id)
    const data = await request.validateUsing(labourRateValidator, { meta: { id: rate.id } })
    try {
      await rate.merge(data).save()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().toRoute('rates.index')
    }

    session.flash('success', i18n.t('flash.labourRateSaved'))
    response.redirect().toRoute('rates.index')
  }

  /**
   * Rates are archived, never deleted: Quote and Visit lines refer to them.
   */
  async archive({ params, response, session, i18n }: HttpContext) {
    const rate = await LabourRate.findOrFail(params.id)
    rate.archivedAt = DateTime.now()
    await rate.save()

    session.flash('success', i18n.t('flash.labourRateArchived', { name: rate.name }))
    response.redirect().toRoute('rates.index')
  }

  async updateCallOutFee({ request, response, session, i18n }: HttpContext) {
    const { callOutFee } = await request.validateUsing(callOutFeeValidator)
    const settings = await CompanySettings.current()
    settings.callOutFee = callOutFee ?? null
    await settings.save()

    session.flash('success', i18n.t('flash.callOutFeeSaved'))
    response.redirect().toRoute('rates.index')
  }
}
