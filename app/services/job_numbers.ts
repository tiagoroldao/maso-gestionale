import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ADVISORY_LOCKS } from '#services/advisory_locks'

/**
 * The next Job number for `year`, taken inside `trx`. A transaction-scoped
 * advisory lock makes concurrent creations wait, so numbers never collide.
 */
export async function nextJobSequence(trx: TransactionClientContract, year: number) {
  await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [ADVISORY_LOCKS.jobNumbers])
  const row = await trx.from('jobs').where('year', year).max('sequence as last').first()
  return Number(row?.last ?? 0) + 1
}
