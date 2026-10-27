import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type * as abilities from '#abilities/main'

/**
 * Abilities that need no argument besides the user, so they can be
 * checked from a route definition.
 */
type RouteAbility = Extract<
  keyof typeof abilities,
  | 'accessBusiness'
  | 'accessInstance'
  | 'manageUsers'
  | 'manageCompany'
  | 'manageCustomers'
  | 'manageItems'
  | 'manageJobs'
>

/**
 * Responds with 403 unless the logged-in user has the given ability.
 * Must run after the `auth` middleware.
 */
export default class CanMiddleware {
  async handle(ctx: HttpContext, next: NextFn, ability: RouteAbility) {
    await ctx.bouncer.authorize(ability)
    return next()
  }
}
