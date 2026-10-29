import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import encryption from '@adonisjs/core/services/encryption'
import pg from 'pg'
import env from '#start/env'
import InstanceSettings from '#models/instance_settings'
import User from '#models/user'
import { createBackupKey, decryptStream, unlockBackupKey } from '#services/backup_encryption'
import { FakeBackupStore, S3BackupStore } from '#services/backup_store'
import { Backups } from '#services/backups'
import { storagePath } from '#services/storage'
import { committedData } from '#tests/helpers/committed'
import { createUser } from '#tests/helpers/users'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import { ADVISORY_LOCKS } from '#services/advisory_locks'

const PASSPHRASE = 'cavallo corretto batteria graffetta'

const fields = {
  backupEndpoint: 'https://s3.fr-par.scw.cloud',
  backupBucket: 'maso-backup',
  backupRegion: 'fr-par',
  backupAccessKeyId: 'SCWACCESSKEY',
  backupSecretAccessKey: 'scw-secret-123',
  backupRetention: '7',
  backupPassphrase: PASSPHRASE,
  backupPassphraseConfirmation: PASSPHRASE,
}

// One key pair for the job tests: making one takes about a second (scrypt)
let key: ReturnType<typeof createBackupKey> | null = null

/**
 * Backups configured as the Superuser would, writing straight to the row.
 */
async function configureBackups(retention = 7) {
  key ??= createBackupKey(PASSPHRASE)
  const { recipient, identity } = await key
  const settings = await InstanceSettings.current()
  settings.merge({
    backupEndpoint: fields.backupEndpoint,
    backupBucket: fields.backupBucket,
    backupRegion: fields.backupRegion,
    backupAccessKeyId: fields.backupAccessKeyId,
    backupRetention: retention,
    backupRecipient: recipient,
    backupIdentity: identity,
  })
  settings.backupSecret = fields.backupSecretAccessKey
  await settings.save()
  return settings
}

/**
 * The bucket the job writes to, in memory.
 */
function fakeBucket(group: { each: { setup: (fn: () => () => void) => void } }) {
  const holder = { store: new FakeBackupStore(), configs: [] as unknown[] }
  group.each.setup(() => {
    holder.store = new FakeBackupStore()
    holder.configs = []
    Backups.store = (config) => {
      holder.configs.push(config)
      return holder.store
    }
    return () => {
      Backups.store = (config) => new S3BackupStore(config)
      Backups.running = null
    }
  })
  return holder
}

test.group('Backup settings', () => {
  test('the Superuser saves where backups go; the secret is encrypted, the passphrase never stored', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')

    const response = await client
      .put('/instance/backups')
      .form(fields)
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.backupSettingsSaved'))

    const settings = await InstanceSettings.findOrFail(1)
    assert.equal(settings.backupEndpoint, 'https://s3.fr-par.scw.cloud')
    assert.equal(settings.backupBucket, 'maso-backup')
    assert.equal(settings.backupRegion, 'fr-par')
    assert.equal(settings.backupAccessKeyId, 'SCWACCESSKEY')
    assert.equal(settings.backupRetention, 7)
    assert.equal(settings.backupSecret, 'scw-secret-123')
    assert.match(settings.backupRecipient!, /^age1/)

    const raw = JSON.stringify(await db.from('instance_settings').where('id', 1).firstOrFail())
    assert.notInclude(raw, 'scw-secret-123')
    assert.notInclude(raw, PASSPHRASE)
    assert.notInclude(raw, 'AGE-SECRET-KEY')
    // The stored private key opens with the passphrase only
    assert.match(await unlockBackupKey(settings.backupIdentity!, PASSPHRASE), /^AGE-SECRET-KEY-1/)

    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({
      backups: { bucket: 'maso-backup', hasSecret: true, recipient: settings.backupRecipient },
    })
    const props = JSON.stringify(page.inertiaProps)
    assert.notInclude(props, 'scw-secret')
    assert.notInclude(props, 'BEGIN AGE ENCRYPTED FILE')
  })

  test('a blank secret and passphrase keep the stored ones; a new passphrase makes a new key', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await client.put('/instance/backups').form(fields).withCsrfToken().loginAs(superuser)
    const before = await InstanceSettings.findOrFail(1)

    await client
      .put('/instance/backups')
      .form({
        ...fields,
        backupRetention: '30',
        backupSecretAccessKey: '',
        backupPassphrase: '',
        backupPassphraseConfirmation: '',
      })
      .withCsrfToken()
      .loginAs(superuser)
    const kept = await InstanceSettings.findOrFail(1)
    assert.equal(kept.backupRetention, 30)
    assert.equal(kept.backupSecret, 'scw-secret-123')
    assert.equal(kept.backupRecipient, before.backupRecipient)
    assert.equal(kept.backupIdentity, before.backupIdentity)

    const other = 'una passphrase del tutto nuova'
    await client
      .put('/instance/backups')
      .form({ ...fields, backupPassphrase: other, backupPassphraseConfirmation: other })
      .withCsrfToken()
      .loginAs(superuser)
    const changed = await InstanceSettings.findOrFail(1)
    assert.notEqual(changed.backupRecipient, before.backupRecipient)
    assert.match(await unlockBackupKey(changed.backupIdentity!, other), /^AGE-SECRET-KEY-1/)
  })

  test('the first save needs the secret and the passphrase; values are checked', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')

    const missing = await client
      .put('/instance/backups')
      .form({ ...fields, backupSecretAccessKey: '', backupPassphrase: '' })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.properties(missing.flashMessage('inputErrorsBag'), [
      'backupSecretAccessKey',
      'backupPassphrase',
    ])

    const invalid = await client
      .put('/instance/backups')
      .form({
        backupEndpoint: 'ftp://s3.example.com',
        backupBucket: 'Maso_Backup',
        backupRegion: 'fr par',
        backupAccessKeyId: '',
        backupSecretAccessKey: 'secret',
        backupRetention: '0',
        backupPassphrase: 'corta',
        backupPassphraseConfirmation: 'diversa',
      })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    const errors = invalid.flashMessage('inputErrorsBag')
    assert.properties(errors, [
      'backupEndpoint',
      'backupBucket',
      'backupRegion',
      'backupAccessKeyId',
      'backupRetention',
      'backupPassphrase',
      'backupPassphraseConfirmation',
    ])
    assert.notProperty(errors, 'backupSecretAccessKey')

    const mismatch = await client
      .put('/instance/backups')
      .form({ ...fields, backupPassphraseConfirmation: `${PASSPHRASE}!` })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.deepEqual(Object.keys(mismatch.flashMessage('inputErrorsBag')), [
      'backupPassphraseConfirmation',
    ])

    const tooMany = await client
      .put('/instance/backups')
      .form({ ...fields, backupRetention: '366' })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.property(tooMany.flashMessage('inputErrorsBag'), 'backupRetention')

    assert.isNull(await InstanceSettings.find(1))
  })

  test('only the Superuser changes backup settings or starts a backup', async ({
    client,
    assert,
  }) => {
    for (const role of ['admin', 'office', 'technician'] as const) {
      const user = await createUser(role)
      for (const request of [
        client.put('/instance/backups').form(fields),
        client.post('/instance/backups/run'),
      ]) {
        const denied = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    for (const request of [
      client.put('/instance/backups').form(fields),
      client.post('/instance/backups/run'),
    ]) {
      const guest = await request.withCsrfToken().redirects(0)
      guest.assertStatus(302)
      guest.assertHeader('location', '/login')
    }
    // Nothing saved, no backup started
    assert.isNull(await InstanceSettings.find(1))
    assert.isNull(Backups.running)
  })

  test('a refused save flashes the errors, never the secret or the passphrase', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')

    const response = await client
      .put('/instance/backups')
      .form({ ...fields, backupBucket: 'Not Valid' })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)

    assert.property(response.flashMessage('inputErrorsBag'), 'backupBucket')
    const flashed = JSON.stringify(response.flashMessages())
    assert.notInclude(flashed, PASSPHRASE)
    assert.notInclude(flashed, fields.backupSecretAccessKey)
    assert.notInclude(flashed, fields.backupAccessKeyId)
  })

  test('secrets encrypted under another APP_KEY (a restore) count as missing', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await configureBackups()
    // What a ciphertext from the old server looks like to this one
    await db
      .from('instance_settings')
      .where('id', 1)
      .update({
        backup_secret_access_key: undecryptable('scw-secret-123'),
        openapi_token: undecryptable('oat_secret'),
        webhook_secret: undecryptable('whsec'),
      })

    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({
      settings: { hasToken: false, tokenUnreadable: true, hasWebhookSecret: false },
      backups: { hasSecret: false },
    })

    // So the secret must be entered again
    const missing = await client
      .put('/instance/backups')
      .form({
        ...fields,
        backupSecretAccessKey: '',
        backupPassphrase: '',
        backupPassphraseConfirmation: '',
      })
      .header('referer', '/instance')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.deepEqual(Object.keys(missing.flashMessage('inputErrorsBag')), ['backupSecretAccessKey'])

    await client
      .put('/instance/backups')
      .form({ ...fields, backupPassphrase: '', backupPassphraseConfirmation: '' })
      .withCsrfToken()
      .loginAs(superuser)
    const saved = await InstanceSettings.findOrFail(1)
    assert.equal(saved.backupSecret, 'scw-secret-123')
  })
})

test.group('Backup job', (group) => {
  const bucket = fakeBucket(group)

  test('"run now" uploads the encrypted archive and its key file, and records the success', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await configureBackups()

    const response = await client
      .post('/instance/backups/run')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.backupStarted'))
    assert.equal(await Backups.running, 'succeeded')

    assert.deepEqual(bucket.configs, [
      {
        endpoint: fields.backupEndpoint,
        bucket: fields.backupBucket,
        region: fields.backupRegion,
        accessKeyId: fields.backupAccessKeyId,
        secretAccessKey: fields.backupSecretAccessKey,
      },
    ])
    const names = [...bucket.store.objects.keys()].sort()
    assert.lengthOf(names, 2)
    assert.match(names[0], /^maso-backup-\d{8}T\d{6}Z\.key\.age$/)
    assert.equal(names[1], names[0].replace('.key.age', '.tar.age'))
    // Encrypted: the dump's own header isn't readable
    const archive = bucket.store.objects.get(names[1])!
    assert.isTrue(archive.subarray(0, 21).equals(Buffer.from('age-encryption.org/v1')))
    assert.notInclude(archive.toString('latin1'), 'PGDMP')

    const settings = await InstanceSettings.findOrFail(1)
    assert.isNull(settings.backupStartedAt)
    assert.isNotNull(settings.backupSucceededAt)
    assert.equal(settings.backupLastName, names[1])
    assert.isNull(settings.backupFailedAt)

    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({
      backups: { lastName: names[1], succeededAt: settings.backupSucceededAt!.toISO() },
    })
  })

  test('a backup already running elsewhere is not started twice', async ({ client, assert }) => {
    const superuser = await createUser('superuser')
    await configureBackups()
    // Another process's run: the lock held on a connection of its own
    const other = await connect()
    await other.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCKS.backup])
    await db.from('instance_settings').where('id', 1).update({ backup_started_at: new Date() })
    try {
      const response = await client
        .post('/instance/backups/run')
        .withCsrfToken()
        .loginAs(superuser)
        .redirects(0)
      response.assertFlashMessage('error', it('flash.backupAlreadyRunning'))
      assert.equal(await Backups.run(), 'busy')
      assert.isNull(Backups.running)
      assert.equal(bucket.store.objects.size, 0)
      const page = await client.get('/instance').withInertia().loginAs(superuser)
      assert.isString(page.inertiaProps.backups.startedAt)
    } finally {
      await other.end()
    }

    // Once that connection is gone (the run ended or its process died),
    // a start time left behind, as in a restored dump, blocks nothing
    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({ backups: { startedAt: null } })
    assert.equal(await Backups.run(), 'succeeded')
    assert.equal(bucket.store.objects.size, 2)
  })

  test('without settings, the failure says backups are not configured', async ({ assert }) => {
    assert.equal(await Backups.run(), 'failed')

    const settings = await InstanceSettings.findOrFail(1)
    assert.isNotNull(settings.backupFailedAt)
    assert.equal(settings.backupFailure, it('errors.backupNotConfigured'))
    assert.isNull(settings.backupStartedAt)
    assert.isNull(settings.backupSucceededAt)
    assert.equal(bucket.store.objects.size, 0)
  })

  test('an upload failure is recorded with its message; the last success stays', async ({
    assert,
  }) => {
    await configureBackups()
    assert.equal(await Backups.run(), 'succeeded')
    const { backupSucceededAt: succeeded } = await InstanceSettings.findOrFail(1)

    bucket.store.failWith = 'Access Denied'
    assert.equal(await Backups.run(), 'failed')

    const settings = await InstanceSettings.findOrFail(1)
    assert.equal(settings.backupFailure, 'Access Denied')
    assert.isNotNull(settings.backupFailedAt)
    assert.equal(settings.backupSucceededAt!.toISO(), succeeded!.toISO())
    assert.isNull(settings.backupStartedAt)
  })

  test('only the newest backups up to the retention count are kept', async ({ assert }) => {
    await configureBackups(2)
    for (const stamp of ['20250101T003000Z', '20250102T003000Z', '20250103T003000Z']) {
      await bucket.store.put(`maso-backup-${stamp}.tar.age`, 'old')
      await bucket.store.put(`maso-backup-${stamp}.key.age`, 'old')
    }
    await bucket.store.put('README.txt', 'not ours')

    assert.equal(await Backups.run(), 'succeeded')

    const { backupLastName } = await InstanceSettings.findOrFail(1)
    assert.sameMembers(
      [...bucket.store.objects.keys()],
      [
        'README.txt',
        'maso-backup-20250103T003000Z.tar.age',
        'maso-backup-20250103T003000Z.key.age',
        backupLastName!,
        backupLastName!.replace('.tar.age', '.key.age'),
      ]
    )
  })

  test('the backup just uploaded is kept even if newer-looking ones fill the retention', async ({
    assert,
  }) => {
    // As after the clock jumped back: existing backups look newer
    await configureBackups(1)
    await bucket.store.put('maso-backup-20991231T003000Z.tar.age', 'from the future')
    await bucket.store.put('maso-backup-20991231T003000Z.key.age', 'from the future')

    assert.equal(await Backups.run(), 'succeeded')

    const { backupLastName } = await InstanceSettings.findOrFail(1)
    assert.sameMembers(
      [...bucket.store.objects.keys()],
      [
        'maso-backup-20991231T003000Z.tar.age',
        'maso-backup-20991231T003000Z.key.age',
        backupLastName!,
        backupLastName!.replace('.tar.age', '.key.age'),
      ]
    )
  })

  for (const command of ['pg_dump', 'tar']) {
    test(`a failing ${command} uploads no archive and records the failure`, async ({
      assert,
      cleanup,
    }) => {
      await configureBackups()
      const before = await InstanceSettings.findOrFail(1)
      // A stand-in first on the PATH: some output, then an error
      const bin = await mkdtemp(join(tmpdir(), 'maso-fake-bin-'))
      await writeFile(
        join(bin, command),
        `#!/bin/sh\nprintf 'partial output'\necho '${command} broke' >&2\nexit 2\n`,
        { mode: 0o755 }
      )
      const path = process.env.PATH
      process.env.PATH = `${bin}:${path}`
      cleanup(async () => {
        process.env.PATH = path
        await rm(bin, { recursive: true, force: true })
      })

      assert.equal(await Backups.run(), 'failed')

      const archives = [...bucket.store.objects.keys()].filter((name) => name.endsWith('.tar.age'))
      assert.deepEqual(archives, [])
      const settings = await InstanceSettings.findOrFail(1)
      assert.equal(settings.backupFailure, `${command} exited with code 2: ${command} broke`)
      assert.isNotNull(settings.backupFailedAt)
      assert.isNull(settings.backupStartedAt)
      assert.equal(settings.backupSucceededAt?.toISO(), before.backupSucceededAt?.toISO())
    })
  }
})

test.group('Backup restore', (group) => {
  const bucket = fakeBucket(group)
  const restored = `${env.get('DB_DATABASE')}_restore`

  test('a backup decrypts with the passphrase and restores into a fresh database', async ({
    assert,
    cleanup,
  }) => {
    cleanup(await committedData())
    const work = await mkdtemp(join(tmpdir(), 'maso-restore-test-'))
    const photo = storagePath('backup-test', 'foto.txt')
    cleanup(async () => {
      await db.rawQuery(`DROP DATABASE IF EXISTS "${restored}"`)
      await rm(work, { recursive: true, force: true })
      await rm(storagePath('backup-test'), { recursive: true, force: true })
      await db.from('instance_settings').where('id', 1).delete()
    })

    const user = await createUser('office', { fullName: 'Da ripristinare' })
    await mkdir(storagePath('backup-test'), { recursive: true })
    await writeFile(photo, 'una foto')
    await configureBackups()
    assert.equal(await Backups.run(), 'succeeded')
    const { backupLastName } = await InstanceSettings.findOrFail(1)

    // As docs/restore.md does with the age tool: the key file with the
    // passphrase, then the archive with the key
    const keyFile = bucket.store.objects.get(backupLastName!.replace('.tar.age', '.key.age'))!
    const secretKey = await unlockBackupKey(keyFile.toString(), PASSPHRASE)
    const archive = bucket.store.objects.get(backupLastName!)!
    const plain = await decryptStream(secretKey, Readable.from([archive]))
    await pipeInto('tar', ['-x', '-f', '-', '-C', work], plain)

    assert.equal(
      await readFile(join(work, 'storage', 'backup-test', 'foto.txt'), 'utf8'),
      'una foto'
    )

    await db.rawQuery(`DROP DATABASE IF EXISTS "${restored}"`)
    await db.rawQuery(`CREATE DATABASE "${restored}"`)
    await pipeInto(
      'pg_restore',
      ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', restored],
      Readable.from([await readFile(join(work, 'database.dump'))]),
      { PGDATABASE: restored }
    )

    const connection = await connect(restored)
    try {
      const { rows } = await connection.query('SELECT full_name, email FROM users WHERE id = $1', [
        user.id,
      ])
      assert.deepEqual(rows, [{ full_name: 'Da ripristinare', email: user.email }])
      const migrations = await connection.query('SELECT count(*)::int AS count FROM adonis_schema')
      assert.isAbove(migrations.rows[0].count, 40)
    } finally {
      await connection.end()
    }
    assert.isNotNull(await User.find(user.id))
  }).tags(['@committed'])
})

/**
 * A ciphertext this server can't decrypt, as one written under another
 * APP_KEY: a valid one with its encrypted payload altered.
 */
function undecryptable(value: string) {
  const parts = encryption.encrypt(value).split('.')
  const payload = parts[1]
  parts[1] = (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1)
  const tampered = parts.join('.')
  if (encryption.decrypt(tampered) !== null) throw new Error('Still decryptable')
  return tampered
}

/**
 * A connection of its own, outside the test's transaction.
 */
async function connect(database = env.get('DB_DATABASE')) {
  const connection = new pg.Client({
    host: env.get('DB_HOST'),
    port: env.get('DB_PORT'),
    user: env.get('DB_USER'),
    password: env.get('DB_PASSWORD'),
    database,
  })
  await connection.connect()
  return connection
}

/**
 * Runs a command with `input` on its stdin; rejects with its stderr.
 */
function pipeInto(command: string, args: string[], input: Readable, extraEnv = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        ...process.env,
        PGHOST: env.get('DB_HOST'),
        PGPORT: String(env.get('DB_PORT')),
        PGUSER: env.get('DB_USER'),
        PGPASSWORD: env.get('DB_PASSWORD') ?? '',
        ...extraEnv,
      },
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr}`))
    )
    input.pipe(child.stdin)
  })
}
