import vine from '@vinejs/vine'
import { SDI_MODES } from '#models/instance_settings'

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
 * A new password for an Admin who lost theirs, set by the Superuser.
 */
export const adminPasswordValidator = vine.create({
  password: vine.string().minLength(8).maxLength(32),
  passwordConfirmation: vine.string().sameAs('password'),
})
