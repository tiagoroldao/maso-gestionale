import app from '@adonisjs/core/services/app'
import { errors, type HttpContext } from '@adonisjs/core/http'

/**
 * The component gallery (#252): every component of the new UI in its
 * states, so one screenshot (`npm run ui:shots -- /dev/ui`) reviews the
 * kit. Development and tests only: in production it answers like an
 * unknown URL (the app's not-found page).
 */
export default class DevUiController {
  async show({ inertia, request }: HttpContext) {
    if (app.inProduction) throw new errors.E_ROUTE_NOT_FOUND([request.method(), request.url()])
    return inertia.render('dev/ui', {})
  }
}
