import { unlink } from 'node:fs/promises'
import CompanySettings from '#models/company_settings'
import { storagePath } from '#services/storage'
import { TAX_REGIMES } from '#fiscal/tax_regimes'
import { companySettingsValidator } from '#validators/company_settings'
import type { HttpContext } from '@adonisjs/core/http'

const LOGO_DIRECTORY = 'company'

export default class CompanySettingsController {
  async edit({ inertia }: HttpContext) {
    const settings = await CompanySettings.current()

    return inertia.render('settings/company', {
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
        iban: settings.iban ?? null,
        email: settings.email ?? null,
        phone: settings.phone ?? null,
        hasLogo: Boolean(settings.logoFile),
        updatedAt: settings.updatedAt?.toISO() ?? null,
      },
      taxRegimes: TAX_REGIMES,
    })
  }

  async update({ request, response, session }: HttpContext) {
    const { logo, removeLogo, ...fields } = await request.validateUsing(companySettingsValidator)
    const settings = await CompanySettings.current()

    settings.merge({
      ...fields,
      streetNumber: fields.streetNumber ?? null,
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

    session.flash('success', 'Company settings saved.')
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
