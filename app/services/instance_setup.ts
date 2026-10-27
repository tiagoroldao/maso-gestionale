import db from '@adonisjs/lucid/services/db'
import User from '#models/user'

/**
 * Arbitrary key for the Postgres advisory lock that serialises first-run
 * setup, so two concurrent submissions can't both create accounts.
 */
const SETUP_LOCK_KEY = 41_000_001

export class SetupAlreadyCompletedError extends Error {
  constructor() {
    super('First-run setup has already been completed')
  }
}

export type SetupInput = {
  superuser: { email: string; password: string }
  admin: { fullName: string; email: string; password: string }
}

/**
 * First-run setup of an Instance: creates the Superuser and the first
 * Admin. The Instance counts as set up as soon as any user exists.
 */
export default class InstanceSetup {
  static async isComplete() {
    const row = await db.from('users').select(db.raw('1')).first()
    return Boolean(row)
  }

  static async run(input: SetupInput) {
    return db.transaction(async (trx) => {
      await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [SETUP_LOCK_KEY])
      if (await trx.from('users').select(trx.raw('1')).first()) {
        throw new SetupAlreadyCompletedError()
      }

      const superuser = await User.create(
        { ...input.superuser, role: 'superuser' },
        { client: trx }
      )
      const admin = await User.create({ ...input.admin, role: 'admin' }, { client: trx })
      return { superuser, admin }
    })
  }
}
