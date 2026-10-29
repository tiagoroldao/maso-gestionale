import Big from 'big.js'
import type { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Invoice from '#models/invoice'
import Payment from '#models/payment'
import type User from '#models/user'
import { owed } from '#shared/payment_status'
import { CREDITED_SQL, PAID_SQL } from '#services/job_status'

/**
 * Not a payment at all: the Invoice is still a draft, or it is a Credit
 * Note (nothing is paid on one; a refund it calls for is a negative
 * Payment on the Invoice it credits).
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
 * What is unusual about a Payment just removed (ADR 0014): it leaves the
 * Invoice overpaid, or owing (`amount` each).
 */
export type PaymentRemovalWarning = { reason: 'overpaid' | 'owing'; amount: string }

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
      if (locked.status === 'draft' || !locked.total || locked.isCreditNote) {
        throw new PaymentRefusedError()
      }
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
      const left = owed({
        total: locked.total,
        credited: await this.credited(trx, locked.id),
        paid: await this.paid(trx, locked.id),
      })
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
   * for a check, so recording and correcting read it alike; it selects
   * PAID_SQL, so checks and list filters can't drift apart.
   */
  static async paid(trx: TransactionClientContract, invoiceId: number) {
    return this.sumOf(trx, invoiceId, PAID_SQL('i'))
  }

  /**
   * What the Invoice's Credit Notes credit (credits(): those past draft),
   * read in `trx`: current when the Invoice is locked there, since a
   * Credit Note locks the Invoice it credits before it changes. It
   * selects CREDITED_SQL, the one place the rule is written for the
   * database.
   */
  static async credited(trx: TransactionClientContract, invoiceId: number) {
    return this.sumOf(trx, invoiceId, CREDITED_SQL('i'))
  }

  private static async sumOf(trx: TransactionClientContract, invoiceId: number, sql: string) {
    const { rows } = await trx.rawQuery(`SELECT ${sql} AS amount FROM invoices i WHERE i.id = ?`, [
      invoiceId,
    ])
    return new Big(rows[0]?.amount ?? 0).toFixed(2)
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
   * Removes a Payment entered by mistake. Like recording, it is never
   * refused but warned about (ADR 0014): removing a refund that leaves the
   * Invoice overpaid (`overpaid`), or a Payment that leaves something
   * owed on it (`owing`).
   */
  static async remove(payment: Payment): Promise<PaymentRemovalWarning[]> {
    return db.transaction(async (trx) => {
      const locked = await Invoice.query({ client: trx })
        .where('id', payment.invoiceId)
        .forUpdate()
        .firstOrFail()
      const removed = await Payment.query({ client: trx }).where('id', payment.id).first()
      if (!removed) return []
      await removed.useTransaction(trx).delete()
      if (!locked.total) return []
      const left = owed({
        total: locked.total,
        credited: await this.credited(trx, locked.id),
        paid: await this.paid(trx, locked.id),
      })
      // As recording its opposite: a refund taken away adds to what was
      // paid, a Payment taken away to what is owed
      const owedNow = new Big(left)
      if (new Big(removed.amount).lt(0)) {
        return owedNow.lt(0) ? [{ reason: 'overpaid', amount: owedNow.abs().toFixed(2) }] : []
      }
      return owedNow.gt(0) ? [{ reason: 'owing', amount: left }] : []
    })
  }
}
