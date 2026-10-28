import type { DateTime } from 'luxon'
import { PaymentTermSchema } from '#database/schema'
import type { PaymentMethod } from '#shared/payments'

/**
 * The rule, set per Customer, that determines an invoice's due date:
 * a number of days after the invoice date, optionally moved to the end
 * of that month ("30 gg fine mese"). With end of month, whole multiples
 * of 30 days count as calendar months, as banks do: 30 days end of month
 * from 31 January is 28 February.
 */
export default class PaymentTerms extends PaymentTermSchema {
  static table = 'payment_terms'

  declare paymentMethod: PaymentMethod

  dueDate(invoiceDate: DateTime) {
    if (!this.endOfMonth) return invoiceDate.plus({ days: this.days })
    const date =
      this.days % 30 === 0
        ? invoiceDate.plus({ months: this.days / 30 })
        : invoiceDate.plus({ days: this.days })
    return date.endOf('month').startOf('day')
  }
}
