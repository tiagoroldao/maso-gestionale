import Big from 'big.js'
import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Invoice from '#models/invoice'
import Payment from '#models/payment'
import type User from '#models/user'

/**
 * The Payment doesn't fit: the Invoice is still a draft, or the amount is
 * more than what is still owed.
 */
export class PaymentRefusedError extends Error {
  constructor(readonly reason: 'draft' | 'tooMuch') {
    super(reason)
  }
}

/**
 * Recording Payments against Invoices. Each change locks the Invoice, so
 * two Payments entered at once can't together exceed what is owed.
 */
export default class Payments {
  static async record(
    invoice: Invoice,
    input: { amount: string; paidOn: DateTime; note?: string | null },
    user: User | null = null
  ) {
    return db.transaction(async (trx) => {
      const locked = await Invoice.query({ client: trx })
        .where('id', invoice.id)
        .forUpdate()
        .preload('payments')
        .firstOrFail()
      if (locked.status === 'draft' || !locked.total) throw new PaymentRefusedError('draft')
      const owed = new Big(locked.total).minus(locked.paid)
      if (new Big(input.amount).gt(owed)) throw new PaymentRefusedError('tooMuch')
      return Payment.create(
        {
          invoiceId: locked.id,
          amount: input.amount,
          paidOn: input.paidOn,
          note: input.note ?? null,
          createdBy: user?.id ?? null,
        },
        { client: trx }
      )
    })
  }

  /**
   * Removes a Payment entered by mistake.
   */
  static async remove(payment: Payment) {
    await db.transaction(async (trx) => {
      await Invoice.query({ client: trx }).where('id', payment.invoiceId).forUpdate().firstOrFail()
      await Payment.query({ client: trx }).where('id', payment.id).delete()
    })
  }
}
