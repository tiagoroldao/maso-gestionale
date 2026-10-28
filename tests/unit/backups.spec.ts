import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createBackupKey,
  decryptStream,
  encryptStream,
  unlockBackupKey,
} from '#services/backup_encryption'
import { backupNames, backupsToPrune, nextBackupAt } from '#services/backups'
import { formatDateTime } from '#shared/dates'

const PASSPHRASE = 'cavallo corretto batteria graffetta'

test.group('Backup encryption', () => {
  test('a backup encrypted to the public key opens only with the passphrase', async ({
    assert,
  }) => {
    const key = await createBackupKey(PASSPHRASE)
    assert.match(key.recipient, /^age1[a-z0-9]+$/)
    // The stored key file holds the private key only encrypted
    assert.match(key.identity, /^-----BEGIN AGE ENCRYPTED FILE-----/)
    assert.notInclude(key.identity, 'AGE-SECRET-KEY')

    const plain = Buffer.from('dump e file'.repeat(10_000))
    const encrypted = await buffer(await encryptStream(key.recipient, Readable.from([plain])))
    assert.notInclude(encrypted.toString('latin1'), 'dump e file')

    const secretKey = await unlockBackupKey(key.identity, PASSPHRASE)
    const decrypted = await buffer(await decryptStream(secretKey, Readable.from([encrypted])))
    assert.isTrue(decrypted.equals(plain))

    await assert.rejects(() => unlockBackupKey(key.identity, 'un altra passphrase'))
  })

  test('each passphrase makes a different key pair', async ({ assert }) => {
    const first = await createBackupKey(PASSPHRASE)
    const second = await createBackupKey(PASSPHRASE)
    assert.notEqual(first.recipient, second.recipient)
  })
})

test.group('Backup names and retention', () => {
  test('a backup is named by its UTC time', ({ assert }) => {
    assert.deepEqual(backupNames(new Date('2026-10-28T00:30:05.123Z')), {
      archive: 'maso-backup-20261028T003005Z.tar.age',
      key: 'maso-backup-20261028T003005Z.key.age',
    })
  })

  test('keeps the newest archives and their keys, never other objects', ({ assert }) => {
    const names = [
      'maso-backup-20261025T003000Z.tar.age',
      'maso-backup-20261025T003000Z.key.age',
      'maso-backup-20261027T003000Z.tar.age',
      'maso-backup-20261027T003000Z.key.age',
      'maso-backup-20261026T003000Z.tar.age',
      'maso-backup-20261026T003000Z.key.age',
      // A failed run's key, with no archive
      'maso-backup-20261028T003000Z.key.age',
      'maso-backup-notes.txt',
      'other/file.tar.age',
    ]
    assert.sameMembers(backupsToPrune(names, 2), [
      'maso-backup-20261025T003000Z.tar.age',
      'maso-backup-20261025T003000Z.key.age',
      'maso-backup-20261028T003000Z.key.age',
    ])
    assert.sameMembers(backupsToPrune(names, 5), ['maso-backup-20261028T003000Z.key.age'])
  })
})

test.group('Backup schedule', () => {
  const at = (iso: string) => DateTime.fromISO(iso, { setZone: true })

  test('runs at the set time in Rome, today if still ahead, else tomorrow', ({ assert }) => {
    // 23:00 UTC on 27 October is 00:00 on the 28th in Rome (UTC+1)
    assert.equal(
      nextBackupAt(at('2026-10-27T23:00:00Z'), '01:30').toISO(),
      '2026-10-28T01:30:00.000+01:00'
    )
    assert.equal(
      nextBackupAt(at('2026-10-28T00:30:00Z'), '01:30').toISO(),
      '2026-10-29T01:30:00.000+01:00'
    )
  })

  test('keeps the local time across daylight saving changes', ({ assert }) => {
    // Clocks went back on 25 October 2026: summer time the day before
    assert.equal(
      nextBackupAt(at('2026-10-24T12:00:00Z'), '01:30').toISO(),
      '2026-10-25T01:30:00.000+02:00'
    )
    assert.equal(
      nextBackupAt(at('2026-10-25T12:00:00Z'), '01:30').toISO(),
      '2026-10-26T01:30:00.000+01:00'
    )
  })

  test('shows a moment in Rome time', ({ assert }) => {
    assert.equal(formatDateTime('2026-10-28T00:30:00Z'), '28/10/2026 01:30')
    assert.equal(formatDateTime('2026-06-30T22:05:00Z'), '01/07/2026 00:05')
    assert.equal(formatDateTime(null), '')
  })
})
