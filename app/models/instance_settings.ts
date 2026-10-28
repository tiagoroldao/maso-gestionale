import encryption from '@adonisjs/core/services/encryption'
import { InstanceSettingSchema } from '#database/schema'

import type { SdiMode } from '#shared/instance'

/**
 * The Superuser's settings for this Instance (ADR 0005): how invoices
 * reach SDI, polling and webhook, the public URL, where backups go. There
 * is exactly one row. Secrets are stored encrypted with APP_KEY.
 */
export default class InstanceSettings extends InstanceSettingSchema {
  static table = 'instance_settings'

  declare sdiMode: SdiMode

  /**
   * The saved settings, or the defaults before the Superuser first saves.
   */
  static async current() {
    return (
      (await this.find(1)) ??
      new this().merge({ id: 1, sdiMode: 'manual', pollingMinutes: 60, backupRetention: 14 })
    )
  }

  set apiKey(value: string | null) {
    this.invoicetronicApiKey = value ? encryption.encrypt(value) : null
  }

  get apiKey(): string | null {
    return this.invoicetronicApiKey ? encryption.decrypt<string>(this.invoicetronicApiKey) : null
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
