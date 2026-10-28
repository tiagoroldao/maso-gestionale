import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { CreditNoteNumberingMode, NumberingSeries } from '#shared/credit_notes'

/**
 * Serialises finalising across years, so the issue date and the year's
 * number come from one reading of the clock taken after the lock; changing
 * how Credit Notes are numbered takes it too, so the change and a Credit
 * Note being numbered can't cross.
 */
export const NUMBERING_LOCK_KEY = 4_190_419

/**
 * How Credit Notes are numbered, an Admin setting (ADR 0014): in the
 * Invoice sequence ("shared", the default) or in their own series
 * ("own"). Numbering runs unbroken through a year, so a change applies at
 * once while no Credit Note has been numbered in the current year, and
 * otherwise from the next 1 January. Stored as the mode from each year on.
 */
export default class CreditNoteNumbering {
  /**
   * The mode for `year`: the latest set for that year or before.
   */
  static async modeFor(
    client: TransactionClientContract | undefined,
    year: number
  ): Promise<CreditNoteNumberingMode> {
    const row = await (client ?? db)
      .from('credit_note_numbering')
      .where('year', '<=', year)
      .orderBy('year', 'desc')
      .first()
    return (row?.mode as CreditNoteNumberingMode | undefined) ?? 'shared'
  }

  /**
   * The series a Credit Note finalised in `year` takes its number from.
   */
  static async seriesFor(
    client: TransactionClientContract,
    year: number
  ): Promise<NumberingSeries> {
    return (await this.modeFor(client, year)) === 'own' ? 'credit_note' : 'invoice'
  }

  /**
   * Whether a Credit Note has been numbered in `year`, in either series.
   */
  static async numberedIn(client: TransactionClientContract | undefined, year: number) {
    const row = await (client ?? db)
      .from('invoices')
      .where('document_type', 'credit_note')
      .where('year', year)
      .first()
    return Boolean(row)
  }

  /**
   * Where the setting stands: this year's mode, next year's, and whether
   * a change still applies this year.
   */
  static async state() {
    const year = DateTime.now().year
    return {
      year,
      current: await this.modeFor(undefined, year),
      next: await this.modeFor(undefined, year + 1),
      changesNow: !(await this.numberedIn(undefined, year)),
    }
  }

  /**
   * Sets the mode: from this year while no Credit Note has been numbered
   * in it, otherwise from next year (choosing this year's mode again
   * cancels a change waiting for 1 January). Returns the year it applies
   * from.
   */
  static async change(mode: CreditNoteNumberingMode) {
    return db.transaction(async (trx) => {
      await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [NUMBERING_LOCK_KEY])
      const year = DateTime.now().year
      const from = (await this.numberedIn(trx, year)) ? year + 1 : year
      // A later change waiting for its year gives way to this one
      await trx.from('credit_note_numbering').where('year', '>', year).delete()
      if ((await this.modeFor(trx, from)) !== mode) {
        await trx
          .insertQuery()
          .table('credit_note_numbering')
          .insert({ year: from, mode, created_at: new Date() })
          .onConflict('year')
          .merge({ mode, updated_at: new Date() })
      }
      return { appliesFrom: from }
    })
  }
}
