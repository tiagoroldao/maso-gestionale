import Big from 'big.js'
import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Invoice from '#models/invoice'
import Payment from '#models/payment'
import type User from '#models/user'
import { owed } from '#shared/payment_status'

/**
 * Not a payment at all: the Invoice is still a draft.
 */
export class PaymentRefusedError extends Error {}

/**
 * What is unusual about a Payment just recorded (ADR 0014): it leaves the
 * Invoice overpaid (by `amount`); as a refund, it gives back more than was
 * overpaid (leaving `amount` owed); or it is dated before the Invoice was
 * issued (on `date`).
 */
export type PaymentWarning =
  | { reason: 'overpaid' | 'refundBeyondOverpaid'; amount: string }
  | { reason: 'beforeIssued'; date: string }

/**
 * Recording Payments against Invoices. Payments and refunds (negative
 * Payments) are records of what happened: anything unusual is recorded
 * with a warning, never refused (ADR 0014). Each change locks the
 * Invoice, so the warning reads what is owed after every other Payment.
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
        .firstOrFail()
      if (locked.status === 'draft' || !locked.total) throw new PaymentRefusedError()
      const payment = await Payment.create(
        {
          invoiceId: locked.id,
          amount: input.amount,
          paidOn: input.paidOn,
          note: input.note ?? null,
          createdBy: user?.id ?? null,
        },
        { client: trx }
      )
      const left = owed({ total: locked.total, paid: await this.paid(trx, locked.id) })
      const warnings: PaymentWarning[] = []
      const amountWarning = this.amountWarning(input.amount, left)
      if (amountWarning) warnings.push(amountWarning)
      const issuedOn = locked.issuedOn?.toISODate()
      if (issuedOn && input.paidOn.toISODate()! < issuedOn) {
        warnings.push({ reason: 'beforeIssued', date: issuedOn })
      }
      return { payment, warnings }
    })
  }

  /**
   * What has been paid on the Invoice, refunds included, read in `trx`:
   * current when the Invoice is locked there. The one place it is summed
   * for a check, so recording and correcting read it alike.
   */
  static async paid(trx: TransactionClientContract, invoiceId: number) {
    const row = await trx
      .from('payments')
      .where('invoice_id', invoiceId)
      .sum('amount as paid')
      .first()
    return new Big(row?.paid ?? 0).toFixed(2)
  }

  /**
   * A Payment that leaves the Invoice overpaid; a refund that leaves
   * something owed gave back more than was overpaid (or was not overpaid).
   */
  private static amountWarning(amount: string, left: string): PaymentWarning | null {
    const owedNow = new Big(left)
    if (new Big(amount).gt(0)) {
      return owedNow.lt(0) ? { reason: 'overpaid', amount: owedNow.abs().toFixed(2) } : null
    }
    return owedNow.gt(0) ? { reason: 'refundBeyondOverpaid', amount: left } : null
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
