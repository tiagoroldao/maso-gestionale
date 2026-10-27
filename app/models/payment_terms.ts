import type { DateTime } from 'luxon'
import { PaymentTermSchema } from '#database/schema'

/**
 * The rule, set per Customer, that determines an invoice's due date:
 * a number of days after the invoice date, optionally moved to the end
 * of that month ("30 gg fine mese").
 */
export default class PaymentTerms extends PaymentTermSchema {
  static table = 'payment_terms'

  dueDate(invoiceDate: DateTime) {
    const date = invoiceDate.plus({ days: this.days })
    return this.endOfMonth ? date.endOf('month').startOf('day') : date
  }

  get label() {
    if (this.days === 0 && !this.endOfMonth) return 'Immediate'
    return `${this.days} days${this.endOfMonth ? ' end of month' : ''}`
  }
}
