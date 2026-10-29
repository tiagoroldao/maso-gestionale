import CompanySettings from '#models/company_settings'
import InstanceSettings from '#models/instance_settings'
import { SdiFailure, type ReceivingCallback, type SdiGateway } from '#services/sdi_gateway'
import { sdiWebhookUrl } from '#shared/instance'

/**
 * Where the receiving callback points when the webhook is off: an address
 * that can never resolve (`.invalid` is reserved), since Openapi needs one
 * registered to receive at all while the app reads by polling (ADR 0019).
 */
export const PLACEHOLDER_CALLBACK_URL = 'https://invalid.invalid/sdi/webhook'

/**
 * The company's fiscal id as the intermediary knows it (Openapi's
 * `fiscal_id`): the VAT number (or tax code) without the country. Null
 * without either in Company settings.
 */
export async function intermediaryFiscalId(): Promise<string | null> {
  const company = await CompanySettings.current()
  return (company.vatNumber || company.taxCode || '').trim().replace(/^IT/i, '') || null
}

/**
 * The receiving callback the settings ask for: the webhook, with its
 * secret, when enabled; the placeholder otherwise. Null without a fiscal
 * id in Company settings.
 */
export async function receivingCallback(
  settings: InstanceSettings
): Promise<ReceivingCallback | null> {
  const fiscalId = await intermediaryFiscalId()
  if (!fiscalId) return null
  const secret = settings.webhookEnabled && settings.publicUrl ? settings.secret : null
  return secret
    ? { fiscalId, url: sdiWebhookUrl(settings.publicUrl!), authHeader: `Bearer ${secret}` }
    : { fiscalId, url: PLACEHOLDER_CALLBACK_URL, authHeader: null }
}

/**
 * Keeps the receiving callback registered at the intermediary, as the
 * settings ask. Without a connection there is nothing to register.
 */
export default class SdiReceiving {
  /** Whether it had to register or change it */
  static async ensure(gateway: SdiGateway, callback?: ReceivingCallback | null) {
    if (!gateway.automatic) return false
    const wanted =
      callback === undefined ? await receivingCallback(await InstanceSettings.current()) : callback
    if (!wanted) throw new SdiFailure('noFiscalId')
    return gateway.ensureReceiving(wanted)
  }
}
