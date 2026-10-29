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
