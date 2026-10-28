import { belongsTo, hasMany, manyToMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { CustomerSchema } from '#database/schema'
import PaymentTerms from '#models/payment_terms'
import Site from '#models/site'
import Job from '#models/job'
import { recipientFrom, type Recipient } from '#documents/document_renderer'

export const CUSTOMER_TYPES = ['private', 'company', 'condominium', 'organisation'] as const
export type CustomerType = (typeof CUSTOMER_TYPES)[number]

/**
 * The person or organization that is billed for work.
 */
export default class Customer extends CustomerSchema {
  /**
   * Not archived: shown in lists and pickers.
   */
  static active = scope((query) => {
    query.whereNull('archived_at')
  })
  declare type: CustomerType

  @belongsTo(() => PaymentTerms)
  declare paymentTerms: BelongsTo<typeof PaymentTerms>

  @manyToMany(() => Site, { pivotTable: 'customer_site' })
  declare sites: ManyToMany<typeof Site>

  @hasMany(() => Job)
  declare jobs: HasMany<typeof Job>

  get displayName() {
    return this.type === 'private'
      ? [this.firstName, this.lastName].filter(Boolean).join(' ')
      : (this.name ?? '')
  }

  /**
   * The Customer as printed in a document's recipient block.
   */
  toRecipient(): Recipient {
    return recipientFrom({
      name: this.displayName,
      street: this.street,
      streetNumber: this.streetNumber,
      postalCode: this.postalCode,
      city: this.city,
      province: this.province,
      vatNumber: this.vatNumber,
      taxCode: this.taxCode,
    })
  }
}
