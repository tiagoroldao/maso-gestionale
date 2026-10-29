import vine from '@vinejs/vine'
import { SDI_MODES } from '#shared/instance'
import { password } from '#validators/user'

/**
 * Instance settings as the Superuser saves them. A blank secret keeps the
 * stored one; `clear…` removes it.
 */
export const instanceSettingsValidator = vine.create({
  sdiMode: vine.enum(SDI_MODES),
  invoicetronicApiKey: vine.string().trim().maxLength(255).optional(),
  clearApiKey: vine.boolean().optional(),
  pollingMinutes: vine.number().withoutDecimals().min(5).max(1440),
  webhookEnabled: vine.boolean().optional(),
  webhookSecret: vine.string().trim().maxLength(255).optional(),
  clearWebhookSecret: vine.boolean().optional(),
  publicUrl: vine
    .string()
    .trim()
    .url({ require_protocol: true, protocols: ['https'] })
    .maxLength(255)
    .optional(),
})

/**
 * Where nightly backups go and the passphrase that protects them (#33).
 * A blank secret or passphrase keeps the stored one; both are required
 * until one is stored.
 */
export const backupSettingsValidator = vine
  .withMetaData<{ hasSecret: boolean; hasKey: boolean }>()
  .create({
    backupEndpoint: vine
      .string()
      .trim()
      .url({ require_protocol: true, protocols: ['https', 'http'], require_tld: false })
      .maxLength(255),
    // S3 bucket names: lower case, digits, dots and hyphens
    backupBucket: vine
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    backupRegion: vine
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,64}$/),
    backupAccessKeyId: vine.string().trim().maxLength(128),
    backupSecretAccessKey: vine
      .string()
      .trim()
      .maxLength(255)
      .optional()
      .requiredWhen((field) => !field.meta.hasSecret),
    backupRetention: vine.number().withoutDecimals().min(1).max(365),
    backupPassphrase: vine
      .string()
      .minLength(12)
      .maxLength(255)
      .optional()
      .requiredWhen((field) => !field.meta.hasKey),
    backupPassphraseConfirmation: vine
      .string()
      .sameAs('backupPassphrase')
      .optional()
      .requiredIfExists('backupPassphrase'),
  })

/**
 * A new password for an Admin who lost theirs, set by the Superuser.
 */
export const adminPasswordValidator = vine.create({
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})
