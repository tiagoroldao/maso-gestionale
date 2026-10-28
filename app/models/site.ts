import { hasMany, manyToMany, scope } from '@adonisjs/lucid/orm'
import type { HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { SiteSchema } from '#database/schema'
import Customer from '#models/customer'
import InstalledEquipment from '#models/installed_equipment'
import Job from '#models/job'
import { likePattern } from '#services/search'

/**
 * A physical address where work is done and equipment is installed,
 * independent of who owns or pays for it.
 */
export default class Site extends SiteSchema {
  /**
   * Not archived: shown in lists and pickers.
   */
  static active = scope((query) => {
    query.whereNull('archived_at')
  })
  @manyToMany(() => Customer, { pivotTable: 'customer_site' })
  declare customers: ManyToMany<typeof Customer>

  @hasMany(() => InstalledEquipment)
  declare installedEquipment: HasMany<typeof InstalledEquipment>

  @hasMany(() => Job)
  declare jobs: HasMany<typeof Job>

  /**
   * Matches the label or any part of the address.
   */
  static search = scope((query, term: string) => {
    query.whereRaw(
      `concat_ws(' ', label, street, street_number, unit, postal_code, city, province) ilike ?`,
      [likePattern(term)]
    )
  })

  /**
   * One line for lists and pickers, such as
   * "Casa al mare — Via Roma 5, int. 3, 20121 Milano (MI)".
   */
  get summary() {
    return this.label ? `${this.label} — ${this.address}` : this.address
  }

  /**
   * The address on one line: "Via Roma 5, int. 3, 20121 Milano (MI)".
   */
  get address() {
    const street = [this.street, this.streetNumber].filter(Boolean).join(' ')
    return [street, this.unit, `${this.postalCode} ${this.city} (${this.province})`]
      .filter(Boolean)
      .join(', ')
  }
}
