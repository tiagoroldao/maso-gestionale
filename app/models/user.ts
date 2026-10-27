import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'

/**
 * The four roles from the glossary. The Superuser manages the Instance;
 * the other three work with business data.
 */
export const ROLES = ['superuser', 'admin', 'office', 'technician'] as const
export type Role = (typeof ROLES)[number]

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  declare role: Role

  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    }

    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
