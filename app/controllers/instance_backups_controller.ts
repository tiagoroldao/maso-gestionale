import InstanceSettings from '#models/instance_settings'
import { createBackupKey } from '#services/backup_encryption'
import { Backups } from '#services/backups'
import { backupSettingsValidator } from '#validators/instance_settings'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Nightly backups in Instance settings (#33), for the Superuser only: where
 * they go, the passphrase that protects them, and "run now". The status is
 * shown by `InstanceController.show`.
 */
export default class InstanceBackupsController {
  async update({ request, response, session, i18n }: HttpContext) {
    const settings = await InstanceSettings.current()
    const data = await request.validateUsing(backupSettingsValidator, {
      meta: {
        hasSecret: Boolean(settings.backupSecretAccessKey),
        hasKey: Boolean(settings.backupRecipient),
      },
    })

    settings.merge({
      backupEndpoint: data.backupEndpoint,
      backupBucket: data.backupBucket,
      backupRegion: data.backupRegion,
      backupAccessKeyId: data.backupAccessKeyId,
      backupRetention: data.backupRetention,
    })
    if (data.backupSecretAccessKey) settings.backupSecret = data.backupSecretAccessKey
    // A new passphrase makes a new key pair; the passphrase itself is
    // never stored
    if (data.backupPassphrase) {
      const key = await createBackupKey(data.backupPassphrase)
      settings.merge({ backupRecipient: key.recipient, backupIdentity: key.identity })
    }
    await settings.save()

    session.flash('success', i18n.t('flash.backupSettingsSaved'))
    response.redirect().toRoute('instance')
  }

  /**
   * Starts a backup in the background; the page shows the outcome once
   * reloaded.
   */
  async run({ response, session, i18n }: HttpContext) {
    const started = await Backups.start()
    session.flash(
      started ? 'success' : 'error',
      i18n.t(started ? 'flash.backupStarted' : 'flash.backupAlreadyRunning')
    )
    response.redirect().toRoute('instance')
  }
}
