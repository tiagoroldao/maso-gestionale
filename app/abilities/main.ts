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
import type Visit from '#models/visit'
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
 * Customers: listing, creating and editing them.
 */
export const manageCustomers = Bouncer.ability((user: User) => {
  return user.role === 'admin' || user.role === 'office'
})

/**
 * Field work: a Technician's own Visits.
 */
export const workInField = Bouncer.ability((user: User) => {
  return user.role === 'technician'
})

/**
 * One Visit's field details (notes, photos, status): its assigned
 * Technicians, and Admin and Office.
 */
export const viewVisit = Bouncer.ability(async (user: User, visit: Visit) => {
  if (user.role === 'admin' || user.role === 'office') return true
  return user.role === 'technician' && (await visit.isAssignedTo(user))
})

/**
 * Jobs: creating, editing and cancelling them.
 */
export const manageJobs = Bouncer.ability((user: User) => {
  return user.role === 'admin' || user.role === 'office'
})

/**
 * Items: the catalogue of stocked articles and their prices.
 */
export const manageItems = Bouncer.ability((user: User) => {
  return user.role === 'admin' || user.role === 'office'
})

/**
 * Seeing purchase and resale prices. Technicians never do (PRD).
 */
export const seePrices = Bouncer.ability((user: User) => {
  return user.role === 'admin' || user.role === 'office'
})

/**
 * Editing the company settings, and the lists of options that belong
 * with them (such as Payment Terms).
 */
export const manageCompany = Bouncer.ability((user: User) => {
  return user.role === 'admin'
})

/**
 * An Admin may only manage Office and Technician accounts, never other
 * Admins or the Superuser.
 */
export const editUser = Bouncer.ability((user: User, target: User) => {
  return user.role === 'admin' && (target.role === 'office' || target.role === 'technician')
})
