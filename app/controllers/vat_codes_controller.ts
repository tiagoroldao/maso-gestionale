import { DateTime } from 'luxon'
import VatCode from '#models/vat_code'
import { isUniqueViolation } from '#services/database_errors'
import { vatCodeValidator } from '#validators/vat_code'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

function toAttributes(data: Infer<typeof vatCodeValidator>) {
  return {
    name: data.name,
    rate: data.rate,
    natura: data.natura ?? null,
    legalNote: data.legalNote ?? null,
  }
}

/**
 * The Admin's VAT Codes (Settings → Codici IVA), seeded for the
 * commercialista to review (ADR 0008).
 */
export default class VatCodesController {
  async index({ inertia }: HttpContext) {
    const codes = await VatCode.query()
      .withScopes((scopes) => scopes.active())
      .orderBy([
        { column: 'rate', order: 'desc' },
        { column: 'name', order: 'asc' },
      ])

    return inertia.render('settings/vat_codes', {
      vatCodes: codes.map((code) => ({
        id: code.id,
        name: code.name,
        rate: code.rate,
        natura: code.natura,
        legalNote: code.legalNote,
      })),
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(vatCodeValidator, { meta: {} })
    try {
      await VatCode.create(toAttributes(data))
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().toRoute('vat_codes.index')
    }

    session.flash('success', i18n.t('flash.vatCodeAdded'))
    response.redirect().toRoute('vat_codes.index')
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const code = await VatCode.findOrFail(params.id)
    const data = await request.validateUsing(vatCodeValidator, { meta: { id: code.id } })
    try {
      await code.merge(toAttributes(data)).save()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().toRoute('vat_codes.index')
    }

    session.flash('success', i18n.t('flash.vatCodeSaved'))
    response.redirect().toRoute('vat_codes.index')
  }

  /**
   * Codes are archived, never deleted: Items and Invoice lines refer to
   * them. An Item keeps an archived code until someone changes it.
   */
  async archive({ params, response, session, i18n }: HttpContext) {
    const code = await VatCode.findOrFail(params.id)
    code.archivedAt = DateTime.now()
    await code.save()

    session.flash('success', i18n.t('flash.vatCodeArchived', { name: code.name }))
    response.redirect().toRoute('vat_codes.index')
  }
}
