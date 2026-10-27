/*
|--------------------------------------------------------------------------
| Bouncer abilities
|--------------------------------------------------------------------------
|
| One ability per kind of access, mapped onto the four roles from the
| glossary. Routes check them through the `can` middleware; controllers
| use `bouncer.allows()` for finer checks.
|
*/

import type User from '#models/user'
import { Bouncer } from '@adonisjs/bouncer'

/**
 * Business data and screens. The Superuser is deliberately excluded
 * (ADR 0005): a support person who needs business access gets a
 * separate Admin or Office account.
 */
export const accessBusiness = Bouncer.ability((user: User) => {
  return user.role === 'admin' || user.role === 'office' || user.role === 'technician'
})

/**
 * Instance settings, reserved for the Superuser.
 */
export const accessInstance = Bouncer.ability((user: User) => {
  return user.role === 'superuser'
})

/**
 * Managing Office and Technician accounts.
 */
export const manageUsers = Bouncer.ability((user: User) => {
  return user.role === 'admin'
})

/**
 * An Admin may only manage Office and Technician accounts, never other
 * Admins or the Superuser.
 */
export const editUser = Bouncer.ability((user: User, target: User) => {
  return user.role === 'admin' && (target.role === 'office' || target.role === 'technician')
})
