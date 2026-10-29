import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { type DateTime } from 'luxon'
import pg from 'pg'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import i18nManager from '@adonisjs/i18n/services/main'
import env from '#start/env'
import InstanceSettings from '#models/instance_settings'
import { encryptStream } from '#services/backup_encryption'
import { S3BackupStore, type BackupStore, type S3Config } from '#services/backup_store'
import { storagePath } from '#services/storage'
import { TIME_ZONE } from '#shared/dates'

/**
 * Nightly encrypted off-site backups (#33, ADR 0002). Each run makes one
 * archive (a `pg_dump` in custom format plus the storage directory),
 * encrypts it to the Instance's backup key (see `backup_encryption.ts`),
 * uploads it with that key's passphrase-protected private key next to it,
 * and deletes the oldest backups beyond the retention count. The outcome
 * is recorded in Instance settings for the Superuser.
 *
 * In the bucket, each backup is two objects with the same UTC timestamp:
 * `maso-backup-20261028T003000Z.tar.age` (the archive) and
 * `maso-backup-20261028T003000Z.key.age` (the key file `age` asks the
 * passphrase for). docs/restore.md restores them.
 */

export const BACKUP_PREFIX = 'maso-backup-'
const BACKUP_OBJECT = /^maso-backup-(\d{8}T\d{6}Z)\.(tar|key)\.age$/

/** The advisory lock key a running backup holds (see `acquireLock`) */
const BACKUP_LOCK = 330_033

export type BackupOutcome = 'succeeded' | 'failed' | 'busy'

/**
 * The two object names of a backup taken at `at`.
 */
export function backupNames(at: Date) {
  const stamp = at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '')
  return { archive: `${BACKUP_PREFIX}${stamp}.tar.age`, key: `${BACKUP_PREFIX}${stamp}.key.age` }
}

/**
 * The backup objects to delete so that only the `retention` newest
 * archives (and their key files) remain. Key files left by a failed run
 * go too; objects not named like a backup are never touched. `uploaded`,
 * the archive just made, is kept whatever its name: if the clock went
 * backwards, it isn't among the newest.
 */
export function backupsToPrune(names: string[], retention: number, uploaded: string) {
  const current = BACKUP_OBJECT.exec(uploaded)?.[1]
  const stamps = names
    .map((name) => BACKUP_OBJECT.exec(name))
    .filter((match) => match?.[2] === 'tar')
    .map((match) => match![1])
    .sort()
    .reverse()
  const kept = new Set(stamps.slice(0, retention))
  return names.filter((name) => {
    const match = BACKUP_OBJECT.exec(name)
    return match !== null && !kept.has(match[1]) && match[1] !== current
  })
}

/**
 * When the nightly backup next runs after `now`: at `time` ("HH:mm") in
 * the business's time zone.
 */
export function nextBackupAt(now: DateTime, time: string) {
  const [hour, minute] = time.split(':').map(Number)
  const today = now.setZone(TIME_ZONE).set({ hour, minute, second: 0, millisecond: 0 })
  return today > now ? today : today.plus({ days: 1 })
}

export class Backups {
  /** How the bucket is reached; tests swap in a fake */
  static store: (config: S3Config) => BackupStore = (config) => new S3BackupStore(config)

  /** The run `start` left going in the background, for tests to wait on */
  static running: Promise<BackupOutcome> | null = null

  /**
   * Takes a backup and waits for it (the nightly job).
   */
  static async run(): Promise<BackupOutcome> {
    const lock = await acquireLock()
    if (!lock) return 'busy'
    return perform(this.store, lock)
  }

  /**
   * Starts a backup in the background (the Superuser's "run now"); false
   * when one is already running.
   */
  static async start(): Promise<boolean> {
    const lock = await acquireLock()
    if (!lock) return false
    this.running = perform(this.store, lock).catch((error) => {
      logger.error({ err: error }, 'Backup status not recorded')
      return 'failed' as const
    })
    return true
  }

  /**
   * Whether a backup is running now, in any process.
   */
  static async isRunning(): Promise<boolean> {
    // A bigint advisory key shows in pg_locks as classid (high 32 bits)
    // and objid (low 32 bits)
    const { rows } = await db.rawQuery(
      `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND classid = 0 AND objid = ?) AS running`,
      [BACKUP_LOCK]
    )
    return rows[0].running
  }
}

/**
 * The lock that lets one backup run at a time, in the scheduler or the web
 * process: a session advisory lock on a connection of its own, held for the
 * whole run. It goes with the connection if the process dies, and unlike a
 * "running" flag in a table it is never in a dump, so a restored Instance
 * doesn't believe a backup is still running.
 */
async function acquireLock(): Promise<pg.Client | null> {
  const client = new pg.Client({
    host: env.get('DB_HOST'),
    port: env.get('DB_PORT'),
    user: env.get('DB_USER'),
    password: env.get('DB_PASSWORD'),
    database: env.get('DB_DATABASE'),
  })
  // A dropped connection only ends the lock; the run reports its own errors
  client.on('error', (error) => logger.warn({ err: error }, 'Backup lock connection lost'))
  await client.connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [BACKUP_LOCK])
    if (rows[0].locked) return client
  } catch (error) {
    await client.end()
    throw error
  }
  await client.end()
  return null
}

/**
 * Only the status columns are written, so a save of the settings during a
 * run isn't overwritten.
 */
async function record(status: Record<string, unknown>) {
  await db.from('instance_settings').where('id', 1).update(status)
}

/**
 * One backup run, holding `lock`, which it releases at the end.
 */
async function perform(
  store: (config: S3Config) => BackupStore,
  lock: pg.Client
): Promise<BackupOutcome> {
  const names = backupNames(new Date())
  let uploaded = false
  try {
    await db.rawQuery('INSERT INTO instance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING')
    await record({ backup_started_at: new Date() })
    const settings = await InstanceSettings.findOrFail(1)
    const config = s3Config(settings)
    if (!config || !settings.backupRecipient || !settings.backupIdentity) {
      throw new BackupNotConfigured()
    }
    const bucket = store(config)

    // The key file first: an archive is never there without it
    await bucket.put(names.key, settings.backupIdentity)
    await withArchive(async (archive) => {
      await bucket.put(names.archive, await encryptStream(settings.backupRecipient!, archive))
    })
    uploaded = true
    await record({
      backup_started_at: null,
      backup_succeeded_at: new Date(),
      backup_last_name: names.archive,
    })
    logger.info({ backup: names.archive }, 'Backup uploaded')

    const stored = await bucket.list(BACKUP_PREFIX)
    for (const name of backupsToPrune(stored, settings.backupRetention, names.archive)) {
      await bucket.remove(name)
    }
    return 'succeeded'
  } catch (error) {
    logger.error({ err: error }, 'Backup failed')
    const message =
      error instanceof BackupNotConfigured
        ? i18nManager.locale(i18nManager.defaultLocale).t('errors.backupNotConfigured')
        : uploaded
          ? i18nManager
              .locale(i18nManager.defaultLocale)
              .t('errors.backupPruneFailed', { message: messageOf(error) })
          : messageOf(error)
    await record({ backup_started_at: null, backup_failed_at: new Date(), backup_failure: message })
    return uploaded ? 'succeeded' : 'failed'
  } finally {
    await lock.end().catch(() => {})
  }
}

function s3Config(settings: InstanceSettings): S3Config | null {
  const secretAccessKey = settings.backupSecret
  if (
    !settings.backupEndpoint ||
    !settings.backupBucket ||
    !settings.backupRegion ||
    !settings.backupAccessKeyId ||
    !secretAccessKey
  ) {
    return null
  }
  return {
    endpoint: settings.backupEndpoint,
    bucket: settings.backupBucket,
    region: settings.backupRegion,
    accessKeyId: settings.backupAccessKeyId,
    secretAccessKey,
  }
}

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 2000)
}

class BackupNotConfigured extends Error {}

/**
 * The plain archive as a stream: a tar of `database.dump` (pg_dump,
 * custom format) and `storage/` (the storage directory). The dump waits
 * in a temporary directory, removed afterwards. The stream fails, rather
 * than ends, if tar does, so a truncated archive is never uploaded.
 */
async function withArchive(use: (archive: Readable) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'maso-backup-'))
  try {
    await runCommand('pg_dump', ['--format=custom'], {
      env: {
        PGHOST: env.get('DB_HOST'),
        PGPORT: String(env.get('DB_PORT')),
        PGUSER: env.get('DB_USER'),
        PGPASSWORD: env.get('DB_PASSWORD') ?? '',
        PGDATABASE: env.get('DB_DATABASE'),
      },
      stdout: createWriteStream(join(dir, 'database.dump')),
    })

    // Linked under a fixed name, and followed by tar (-h)
    const storage = resolvePath(storagePath())
    const exists = await stat(storage).then(
      (s) => s.isDirectory(),
      () => false
    )
    if (exists) await symlink(storage, join(dir, 'storage'))
    else await mkdir(join(dir, 'storage'))

    const archive = new PassThrough()
    const tar = runCommand('tar', ['-c', '-h', '-f', '-', '-C', dir, 'database.dump', 'storage'], {
      stdout: archive,
    })
    try {
      await Promise.all([use(archive), tar])
    } finally {
      // Stops tar if the upload failed first
      archive.destroy()
      await tar.catch(() => {})
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Runs a command writing its output to `stdout`, which ends only once the
 * command has exited successfully; otherwise `stdout` is destroyed with
 * the command's stderr as the error. Closing `stdout` early (the upload
 * failed) stops the command.
 */
function runCommand(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; stdout: Writable }
) {
  return new Promise<void>((resolve, reject) => {
    const { stdout } = options
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)))
    child.stdout.pipe(stdout, { end: false })
    stdout.once('error', reject)
    stdout.once('close', () => {
      if (child.exitCode === null) child.kill()
    })
    child.on('error', (error) => {
      stdout.destroy(error)
      reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        stdout.once('finish', () => resolve())
        stdout.end()
      } else {
        const error = new Error(`${command} exited with code ${code}: ${stderr.trim()}`)
        stdout.destroy(error)
        reject(error)
      }
    })
  })
}
