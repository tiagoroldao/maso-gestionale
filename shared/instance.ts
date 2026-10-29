/**
 * How finalised Invoices reach SDI (ADR 0019): uploaded by hand, or sent
 * through Openapi.
 */
export const SDI_MODES = ['manual', 'openapi'] as const
export type SdiMode = (typeof SDI_MODES)[number]

/** Openapi's two environments: the sandbox for development, production for real Invoices */
export const SDI_ENVIRONMENTS = ['sandbox', 'production'] as const
export type SdiEnvironment = (typeof SDI_ENVIRONMENTS)[number]

/** Where the intermediary's webhook calls, under the public URL */
export const SDI_WEBHOOK_PATH = '/sdi/webhook'

/** The webhook's address under the public URL */
export function sdiWebhookUrl(publicUrl: string) {
  return `${publicUrl.replace(/\/+$/, '')}${SDI_WEBHOOK_PATH}`
}

/**
 * Legal archiving (conservazione a norma) at the intermediary, as the
 * Instance page shows it (ADR 0019): an account setting the app reads,
 * never switches. `manual` without an intermediary, `unknown` until it
 * is read, then `active` or `inactive`.
 */
export const LEGAL_STORAGE_STATUSES = ['manual', 'unknown', 'active', 'inactive'] as const
export type LegalStorageStatus = (typeof LEGAL_STORAGE_STATUSES)[number]
