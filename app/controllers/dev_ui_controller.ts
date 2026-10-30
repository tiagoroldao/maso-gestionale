import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The component gallery (#252): every component of the new UI in its
 * states, so one screenshot (`npm run ui:shots -- /dev/ui`) reviews the
 * kit. Development and tests only: in production it does not exist (404).
 */
export default class DevUiController {
  async show({ inertia, response }: HttpContext) {
    if (app.inProduction) return response.notFound()
    return inertia.render('dev/ui', {})
  }
}
