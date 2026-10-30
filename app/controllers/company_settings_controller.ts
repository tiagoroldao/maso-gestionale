import { unlink } from 'node:fs/promises'
import CompanySettings from '#models/company_settings'
import { DEFAULT_LIQUIDATION_STATUS } from '#shared/company'
import { storagePath } from '#services/storage'
import { TAX_REGIMES } from '#fiscal/tax_regimes'
import { companySettingsValidator } from '#validators/company_settings'
import { declareActions } from '#shared/screen_actions'
import type { HttpContext } from '@adonisjs/core/http'

const LOGO_DIRECTORY = 'company'

export default class CompanySettingsController {
  async edit({ inertia, i18n }: HttpContext) {
    const settings = await CompanySettings.current()

    return inertia.render('settings/company', {
      // The screen is its own form: Save submits it (docs/ui.md "Actions")
      actions: declareActions([
        {
          name: 'save',
          label: i18n.t('ui.company.save'),
          rank: 'primary',
          kind: 'submit',
          form: 'company-settings',
        },
      ]),
      settings: {
        name: settings.name ?? null,
        vatNumber: settings.vatNumber ?? null,
        taxCode: settings.taxCode ?? null,
        taxRegime: settings.taxRegime ?? null,
        street: settings.street ?? null,
        streetNumber: settings.streetNumber ?? null,
        postalCode: settings.postalCode ?? null,
        city: settings.city ?? null,
        province: settings.province ?? null,
        reaOffice: settings.reaOffice ?? null,
        reaNumber: settings.reaNumber ?? null,
        shareCapital: settings.shareCapital ?? null,
        soleShareholder: settings.soleShareholder ?? null,
        liquidationStatus: settings.liquidationStatus ?? DEFAULT_LIQUIDATION_STATUS,
        iban: settings.iban ?? null,
        email: settings.email ?? null,
        phone: settings.phone ?? null,
        hasLogo: Boolean(settings.logoFile),
        updatedAt: settings.updatedAt?.toISO() ?? null,
      },
      taxRegimes: TAX_REGIMES,
    })
  }

  async update({ request, response, session, i18n }: HttpContext) {
    const { logo, removeLogo, ...fields } = await request.validateUsing(companySettingsValidator)
    const settings = await CompanySettings.current()

    settings.merge({
      ...fields,
      streetNumber: fields.streetNumber ?? null,
      reaOffice: fields.reaOffice ?? null,
      reaNumber: fields.reaNumber ?? null,
      shareCapital: fields.shareCapital ?? null,
      soleShareholder: fields.soleShareholder ?? null,
      liquidationStatus: fields.liquidationStatus ?? DEFAULT_LIQUIDATION_STATUS,
      iban: fields.iban ?? null,
      email: fields.email ?? null,
      phone: fields.phone ?? null,
    })

    if (logo || removeLogo) {
      await this.deleteLogo(settings.logoFile)
      settings.logoFile = null
    }
    if (logo) {
      const fileName = `logo-${Date.now()}.${logo.extname}`
      await logo.move(storagePath(LOGO_DIRECTORY), { name: fileName })
      settings.logoFile = `${LOGO_DIRECTORY}/${fileName}`
    }

    await settings.save()

    session.flash('success', i18n.t('flash.companySaved'))
    response.redirect().toRoute('company_settings.edit')
  }

  async logo({ response }: HttpContext) {
    const settings = await CompanySettings.current()
    if (!settings.logoFile) return response.notFound()

    response.header('cache-control', 'private, no-cache')
    return response.download(storagePath(settings.logoFile))
  }

  private async deleteLogo(file: string | null) {
    if (!file) return
    await unlink(storagePath(file)).catch(() => {})
  }
}
