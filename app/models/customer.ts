import { belongsTo, manyToMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, ManyToMany } from '@adonisjs/lucid/types/relations'
import { CustomerSchema } from '#database/schema'
import PaymentTerms from '#models/payment_terms'
import Site from '#models/site'
import type { Recipient } from '#documents/document_renderer'

export const CUSTOMER_TYPES = ['private', 'company', 'condominium'] as const
export type CustomerType = (typeof CUSTOMER_TYPES)[number]

/**
 * The person or organization that is billed for work.
 */
export default class Customer extends CustomerSchema {
  declare type: CustomerType

  @belongsTo(() => PaymentTerms)
  declare paymentTerms: BelongsTo<typeof PaymentTerms>

  @manyToMany(() => Site, { pivotTable: 'customer_site' })
  declare sites: ManyToMany<typeof Site>

  get displayName() {
    return this.type === 'private'
      ? [this.firstName, this.lastName].filter(Boolean).join(' ')
      : (this.name ?? '')
  }

  /**
   * The Customer as printed in a document's recipient block.
   */
  toRecipient(): Recipient {
    return {
      name: this.displayName,
      addressLines: [
        [this.street, this.streetNumber].filter(Boolean).join(', '),
        `${this.postalCode} ${this.city} (${this.province})`,
      ],
      vatNumber: this.vatNumber,
      taxCode: this.taxCode,
    }
  }
}
