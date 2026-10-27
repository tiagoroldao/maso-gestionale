import { manyToMany, scope } from '@adonisjs/lucid/orm'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'
import { SiteSchema } from '#database/schema'
import Customer from '#models/customer'
import { likePattern } from '#services/search'

/**
 * A physical address where work is done and equipment is installed,
 * independent of who owns or pays for it.
 */
export default class Site extends SiteSchema {
  @manyToMany(() => Customer, { pivotTable: 'customer_site' })
  declare customers: ManyToMany<typeof Customer>

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
    const street = [this.street, this.streetNumber].filter(Boolean).join(' ')
    const address = [street, this.unit, `${this.postalCode} ${this.city} (${this.province})`]
      .filter(Boolean)
      .join(', ')
    return this.label ? `${this.label} — ${address}` : address
  }
}
