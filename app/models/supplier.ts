import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { SupplierSchema } from '#database/schema'
import SupplierInvoice from '#models/supplier_invoice'

/**
 * A business the company buys from, known by its VAT number (country and
 * code): created by Office, or the first time one of its invoices arrives
 * (SupplierInvoices.receive()).
 */
export default class Supplier extends SupplierSchema {
  static table = 'suppliers'

  @hasMany(() => SupplierInvoice)
  declare invoices: HasMany<typeof SupplierInvoice>
}
