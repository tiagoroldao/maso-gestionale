import InstanceSettings from '#models/instance_settings'
import User from '#models/user'
import { Backups } from '#services/backups'
import { adminPasswordValidator, instanceSettingsValidator } from '#validators/instance_settings'
import SdiReceivedFile from '#models/sdi_received_file'
import { sdiWebhookUrl } from '#shared/instance'
import { isSdiFailureCode, type PollFailure } from '#shared/sdi_failures'
import SdiConnection from '#services/sdi_connection'
import LegalStorage from '#services/legal_storage'
import SdiReceiving from '#services/sdi_receiving'
import SupplierInvoiceArchiving, {
  ArchivingRefusedError,
} from '#services/supplier_invoice_archiving'
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
        // The intermediary's account setting, as read: never switched here (#224)
        legalStorage: LegalStorage.status(await SdiConnection.gateway(), settings),
        legalStorageReadAt: settings.sdiLegalStorageReadAt?.toISO() ?? null,
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
        // Uploaded Supplier Invoices never sent to legal archiving, for the
        // one-off action that queues them (#214): a count, no business data
        receivedNotArchived: await SupplierInvoiceArchiving.neverQueued(),
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

    // Another account (mode, environment or token): its legal archiving
    // setting is read again (#224)
    const otherAccount =
      data.sdiMode !== settings.sdiMode ||
      data.sdiEnvironment !== settings.sdiEnvironment ||
      Boolean(data.openapiToken) ||
      Boolean(data.clearToken)
    // One toast shows at a time: a warning says "saved" too, and replaces
    // the plain confirmation (#215)
    let warning: string | null = null
    settings.merge({
      sdiMode: data.sdiMode,
      sdiEnvironment: data.sdiEnvironment,
      ...(otherAccount ? { sdiLegalStorage: null, sdiLegalStorageReadAt: null } : {}),
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
    // (ADR 0019), and its account says whether it archives (#224); the
    // poller retries either if it fails. Only in Openapi mode.
    if (settings.sdiMode === 'openapi') {
      const gateway = await SdiConnection.gateway()
      const failure = (key: string, error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        return i18n.t(key, {
          detail: isSdiFailureCode(detail) ? i18n.t(`ui.sdiFailures.${detail}`) : detail,
        })
      }
      try {
        await SdiReceiving.ensure(gateway)
      } catch (error) {
        warning = failure('flash.receivingNotRegistered', error)
      }
      if (gateway.automatic) {
        try {
          await LegalStorage.refresh(gateway)
        } catch (error) {
          warning ??= failure('flash.legalStorageNotRead', error)
        }
      }
    }
    if (warning) session.flash('warning', warning)
    else session.flash('success', i18n.t('flash.instanceSaved'))
    response.redirect().toRoute('instance')
  }

  /**
   * The one-off action (#214): queues for legal archiving every uploaded
   * Supplier Invoice never sent to it; the next poll sends them.
   */
  async archiveSupplierInvoices({ response, session, i18n }: HttpContext) {
    try {
      const count = await SupplierInvoiceArchiving.queueExisting()
      session.flash('success', i18n.t('flash.supplierInvoicesQueued', { count }))
    } catch (error) {
      if (!(error instanceof ArchivingRefusedError)) throw error
      session.flash('error', i18n.t('flash.supplierInvoiceArchivingRefused.notOffered'))
    }
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
