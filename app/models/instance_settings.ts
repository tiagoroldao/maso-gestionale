import encryption from '@adonisjs/core/services/encryption'
import { InstanceSettingSchema } from '#database/schema'

import type { SdiEnvironment, SdiMode } from '#shared/instance'

/**
 * The Superuser's settings for this Instance (ADR 0005): how invoices
 * reach SDI, polling and webhook, the public URL, where backups go. There
 * is exactly one row. Secrets are stored encrypted with APP_KEY.
 */
export default class InstanceSettings extends InstanceSettingSchema {
  static table = 'instance_settings'

  declare sdiMode: SdiMode
  declare sdiEnvironment: SdiEnvironment

  /**
   * The saved settings, or the defaults before the Superuser first saves.
   */
  static async current() {
    return (
      (await this.find(1)) ??
      new this().merge({
        id: 1,
        sdiMode: 'manual',
        sdiEnvironment: 'sandbox',
        pollingMinutes: 60,
        backupRetention: 14,
      })
    )
  }

  /** Openapi's token (ADR 0019) */
  set token(value: string | null) {
    this.openapiToken = value ? encryption.encrypt(value) : null
  }

  get token(): string | null {
    return this.openapiToken ? encryption.decrypt<string>(this.openapiToken) : null
  }

  /**
   * A token is stored but no longer decrypts: APP_KEY changed (a restore
   * with a new key). It must be entered again.
   */
  get tokenUnreadable() {
    return this.openapiToken !== null && this.token === null
  }

  set secret(value: string | null) {
    this.webhookSecret = value ? encryption.encrypt(value) : null
  }

  get secret(): string | null {
    return this.webhookSecret ? encryption.decrypt<string>(this.webhookSecret) : null
  }

  set backupSecret(value: string | null) {
    this.backupSecretAccessKey = value ? encryption.encrypt(value) : null
  }

  get backupSecret(): string | null {
    return this.backupSecretAccessKey
      ? encryption.decrypt<string>(this.backupSecretAccessKey)
      : null
  }
}
