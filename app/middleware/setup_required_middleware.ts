import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import InstanceSetup from '#services/instance_setup'

/**
 * Sends every request to the first-run setup until the Instance has
 * its first users, and keeps the setup routes closed afterwards.
 */
export default class SetupRequiredMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const onSetupRoute = ctx.request.url() === '/setup'
    const complete = await InstanceSetup.isComplete()

    if (!complete && !onSetupRoute) {
      return ctx.response.redirect().toRoute('setup.create')
    }
    if (complete && onSetupRoute) {
      return ctx.response.redirect().toRoute('session.create')
    }

    return next()
  }
}
