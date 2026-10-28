import { DateTime } from 'luxon'
import Invoices, { NumberingLockedError } from '#services/invoices'
import CreditNoteNumbering from '#services/credit_note_numbering'
import CompanySettings from '#models/company_settings'
import {
  creditNoteNumberingValidator,
  invoiceNumberingValidator,
  sdiPrefixValidator,
} from '#validators/invoice'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Where each year's invoice numbering starts (Settings → Numerazione),
 * for the current year and the next, and how Credit Notes are numbered.
 */
export default class InvoiceNumberingController {
  /**
   * Credit Notes in the Invoice sequence or their own series (ADR 0014):
   * at once while none has been numbered this year, otherwise from the
   * next 1 January; the warning says which.
   */
  async updateCreditNotes({ request, response, session, i18n }: HttpContext) {
    const { mode } = await request.validateUsing(creditNoteNumberingValidator)
    const { appliesFrom } = await CreditNoteNumbering.change(mode)
    const when =
      appliesFrom === DateTime.now().year
        ? i18n.t('flash.creditNoteNumbering.now')
        : i18n.t('flash.creditNoteNumbering.nextYear', { year: appliesFrom })
    session.flash(
      'warning',
      `${i18n.t(`flash.creditNoteNumbering.${mode}`)} ${when} ${i18n.t('flash.creditNoteNumbering.unbroken')}`
    )
    response.redirect().toRoute('invoice_numbering.index')
  }

  /**
   * The letter SDI file progressives start with (see Submissions).
   */
  async updateSdiPrefix({ request, response, session, i18n }: HttpContext) {
    const { sdiFilePrefix } = await request.validateUsing(sdiPrefixValidator)
    const settings = await CompanySettings.current()
    settings.sdiFilePrefix = sdiFilePrefix
    await settings.save()
    session.flash('success', i18n.t('flash.sdiPrefixSaved'))
    response.redirect().toRoute('invoice_numbering.index')
  }

  async index({ inertia }: HttpContext) {
    const year = DateTime.now().year
    const settings = await CompanySettings.current()
    return inertia.render('settings/invoice_numbering', {
      years: [await Invoices.numbering(year), await Invoices.numbering(year + 1)],
      sdiFilePrefix: settings.sdiFilePrefix ?? 'M',
      creditNotes: await CreditNoteNumbering.state(),
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const year = Number(params.year)
    const current = DateTime.now().year
    if (year !== current && year !== current + 1) return response.notFound()
    const { nextNumber } = await request.validateUsing(invoiceNumberingValidator)

    try {
      await Invoices.setNextNumber(year, nextNumber)
    } catch (error) {
      if (!(error instanceof NumberingLockedError)) throw error
      session.flash('error', i18n.t('flash.numberingLocked', { year }))
      return response.redirect().toRoute('invoice_numbering.index')
    }

    session.flash('success', i18n.t('flash.numberingSaved', { year }))
    response.redirect().toRoute('invoice_numbering.index')
  }
}
