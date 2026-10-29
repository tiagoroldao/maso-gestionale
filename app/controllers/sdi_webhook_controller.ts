import { safeEqual } from '@adonisjs/core/helpers'
import db from '@adonisjs/lucid/services/db'
import InstanceSettings from '#models/instance_settings'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The intermediary's webhook (ADR 0019): a call only asks the poller for
 * an earlier poll, so its body is never read or trusted. It answers only
 * when the Superuser enabled it with a secret, and the call carries that
 * secret in its Authorization header (as is, or after "Bearer ").
 */
export default class SdiWebhookController {
  async notify({ request, response }: HttpContext) {
    const settings = await InstanceSettings.current()
    const secret = settings.webhookEnabled ? settings.secret : null
    if (!secret) return response.notFound()

    const header = (request.header('authorization') ?? '').trim()
    const given = header.replace(/^Bearer\s+/i, '')
    if (!given || !safeEqual(given, secret)) return response.unauthorized()

    await db.from('instance_settings').where('id', 1).update({ sdi_poll_requested_at: new Date() })
    return response.noContent()
  }
}
