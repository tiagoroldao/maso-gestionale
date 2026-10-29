import InstanceSettings from '#models/instance_settings'
import User from '#models/user'
import { Backups } from '#services/backups'
import { adminPasswordValidator, instanceSettingsValidator } from '#validators/instance_settings'
import SdiReceivedFile from '#models/sdi_received_file'
import { sdiWebhookUrl } from '#shared/instance'
import { isSdiFailureCode, type PollFailure } from '#shared/sdi_failures'
import SdiConnection, { supportsLegalArchiving } from '#services/sdi_connection'
import SdiReceiving from '#services/sdi_receiving'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'

/**
 * Instance settings, for the Superuser only (ADR 0005). Nothing here shows
 * business data: Admin accounts are listed by name and email only, to set
 * a new password when the Admin lost theirs. Backup settings are saved by
 * `InstanceBackupsController`.
 */
export default class InstanceController {
  async show({ inertia }: HttpContext) {
    const settings = await InstanceSettings.current()
    const admins = await User.query().where('role', 'admin').orderBy('email')
    const waiting = await SdiReceivedFile.query().whereNull('handedAt').count('* as total').first()

    return inertia.render('instance', {
      settings: {
        sdiMode: settings.sdiMode,
        sdiEnvironment: settings.sdiEnvironment,
        // Offered only when the saved intermediary archives (#205)
        legalArchivingOffered: supportsLegalArchiving(settings.sdiMode),
        legalArchiving: settings.sdiLegalArchiving,
        // Whether a usable secret is stored, never the secret: one
        // encrypted under another APP_KEY (after a restore) reads as null,
        // and the page says it must be entered again
        hasToken: settings.token !== null,
        tokenUnreadable: settings.tokenUnreadable,
        pollingMinutes: settings.pollingMinutes,
        webhookEnabled: settings.webhookEnabled,
        hasWebhookSecret: settings.secret !== null,
        secretUnreadable: settings.webhookSecret !== null && settings.secret === null,
        publicUrl: settings.publicUrl,
        // What to give Openapi as the callback address
        webhookUrl: settings.publicUrl ? sdiWebhookUrl(settings.publicUrl) : null,
        polledAt: settings.sdiPolledAt?.toISO() ?? null,
        pollFailures: pollFailures(settings.sdiPollFailure),
        // Supplier Invoice files received and not yet taken by the intake (#198)
        receivedWaiting: Number(waiting?.$extras.total ?? 0),
      },
      backups: {
        endpoint: settings.backupEndpoint ?? null,
        bucket: settings.backupBucket ?? null,
        region: settings.backupRegion ?? null,
        accessKeyId: settings.backupAccessKeyId ?? null,
        hasSecret: settings.backupSecret !== null,
        retention: settings.backupRetention,
        // The public key only: the passphrase is never stored
        recipient: settings.backupRecipient ?? null,
        // Shown only while a run holds the lock: a run that died, or one
        // caught in a restored dump, isn't running
        startedAt: (await Backups.isRunning()) ? (settings.backupStartedAt?.toISO() ?? null) : null,
        succeededAt: settings.backupSucceededAt?.toISO() ?? null,
        lastName: settings.backupLastName ?? null,
        failedAt: settings.backupFailedAt?.toISO() ?? null,
        failure: settings.backupFailure ?? null,
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
    const settings = await InstanceSettings.current()
    let data
    try {
      data = await request.validateUsing(instanceSettingsValidator, {
        meta: { hasToken: settings.token !== null, hasSecret: settings.secret !== null },
      })
    } catch (error) {
      if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error
      // The errors only, never the input: the token and the webhook secret
      // don't travel back in the session cookie
      session.flashValidationErrors(error, false)
      return response.redirect().back()
    }

    // Legal archiving stays on only with an intermediary that offers it;
    // switching to one that doesn't turns it off, with a warning (#205)
    const archivingOffered = supportsLegalArchiving(data.sdiMode)
    const wantsArchiving = data.sdiLegalArchiving ?? false
    // One toast shows at a time: a warning says "saved" too, and replaces
    // the plain confirmation (#215)
    let warning: string | null = null
    if (!archivingOffered && (wantsArchiving || settings.sdiLegalArchiving)) {
      warning = i18n.t('flash.legalArchivingOff')
    }
    settings.merge({
      sdiMode: data.sdiMode,
      sdiEnvironment: data.sdiEnvironment,
      sdiLegalArchiving: archivingOffered && wantsArchiving,
      pollingMinutes: data.pollingMinutes,
      webhookEnabled: data.webhookEnabled ?? false,
      publicUrl: data.publicUrl ?? null,
    })
    if (data.openapiToken) settings.token = data.openapiToken
    else if (data.clearToken) settings.token = null
    if (data.webhookSecret) settings.secret = data.webhookSecret
    else if (data.clearWebhookSecret) settings.secret = null
    await settings.save()

    // Openapi receives Supplier Invoices only with a callback registered
    // (ADR 0019); the poller retries if this fails. Only in Openapi mode,
    // so never alongside the archiving warning above.
    if (settings.sdiMode === 'openapi') {
      try {
        await SdiReceiving.ensure(await SdiConnection.gateway())
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        warning = i18n.t('flash.receivingNotRegistered', {
          detail: isSdiFailureCode(detail) ? i18n.t(`ui.sdiFailures.${detail}`) : detail,
        })
      }
    }
    if (warning) session.flash('warning', warning)
    else session.flash('success', i18n.t('flash.instanceSaved'))
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

/**
 * The last poll's failed steps, as the poller stored them (ADR 0019).
 */
function pollFailures(stored: string | null): PollFailure[] {
  if (!stored) return []
  try {
    return JSON.parse(stored) as PollFailure[]
  } catch {
    return []
  }
}
