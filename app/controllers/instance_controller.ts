import InstanceSettings from '#models/instance_settings'
import User from '#models/user'
import { adminPasswordValidator, instanceSettingsValidator } from '#validators/instance_settings'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Instance settings, for the Superuser only (ADR 0005). Nothing here shows
 * business data: Admin accounts are listed by name and email only, to set
 * a new password when the Admin lost theirs.
 */
export default class InstanceController {
  async show({ inertia }: HttpContext) {
    const settings = await InstanceSettings.current()
    const admins = await User.query().where('role', 'admin').orderBy('email')

    return inertia.render('instance', {
      settings: {
        sdiMode: settings.sdiMode,
        // Whether a secret is stored, never the secret
        hasApiKey: settings.invoicetronicApiKey !== null,
        pollingMinutes: settings.pollingMinutes,
        webhookEnabled: settings.webhookEnabled,
        hasWebhookSecret: settings.webhookSecret !== null,
        publicUrl: settings.publicUrl,
      },
      admins: admins.map((admin) => ({
        id: admin.id,
        name: admin.fullName,
        email: admin.email,
        active: admin.isActive,
      })),
    })
  }

  async update({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(instanceSettingsValidator)
    // Automatic Submission isn't built yet (#92)
    if (data.sdiMode !== 'manual') {
      session.flash('error', i18n.t('flash.invoicetronicNotAvailable'))
      return response.redirect().toRoute('instance')
    }

    const settings = await InstanceSettings.current()
    settings.merge({
      sdiMode: data.sdiMode,
      pollingMinutes: data.pollingMinutes,
      webhookEnabled: data.webhookEnabled ?? false,
      publicUrl: data.publicUrl ?? null,
    })
    if (data.clearApiKey) settings.apiKey = null
    else if (data.invoicetronicApiKey) settings.apiKey = data.invoicetronicApiKey
    if (data.clearWebhookSecret) settings.secret = null
    else if (data.webhookSecret) settings.secret = data.webhookSecret
    await settings.save()

    session.flash('success', i18n.t('flash.instanceSaved'))
    response.redirect().toRoute('instance')
  }

  /**
   * Account recovery: a new password for an Admin.
   */
  async setAdminPassword({ params, request, response, session, i18n }: HttpContext) {
    const admin = await User.query().where('id', params.id).where('role', 'admin').firstOrFail()
    const { password } = await request.validateUsing(adminPasswordValidator)
    admin.password = password
    await admin.save()

    session.flash('success', i18n.t('flash.adminPasswordSet', { email: admin.email }))
    response.redirect().toRoute('instance')
  }
}
