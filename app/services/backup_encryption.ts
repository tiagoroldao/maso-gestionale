import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import {
  Decrypter,
  Encrypter,
  armor,
  generateX25519Identity,
  identityToRecipient,
} from 'age-encryption'

/**
 * How backups are encrypted (#33): age (age-encryption.org), with an X25519
 * key pair made when the Superuser sets the backup passphrase. The server
 * keeps the public key (the recipient) to encrypt each backup, and the
 * private key only encrypted with the passphrase, which it never stores:
 * it can encrypt backups but not decrypt them. Restoring needs the
 * passphrase, with the standard `age` tool (docs/restore.md).
 */

export type BackupKey = {
  /** The public key backups are encrypted to (`age1…`) */
  recipient: string
  /**
   * An age identity file holding the private key, encrypted with the
   * passphrase (ASCII armored). `age -d -i <file>` asks for the passphrase.
   */
  identity: string
}

/**
 * A new key pair whose private key only the passphrase unlocks.
 */
export async function createBackupKey(passphrase: string): Promise<BackupKey> {
  const secretKey = await generateX25519Identity()
  const recipient = await identityToRecipient(secretKey)
  const encrypter = new Encrypter()
  encrypter.setPassphrase(passphrase)
  const file = `# public key: ${recipient}\n${secretKey}\n`
  return { recipient, identity: armor.encode(await encrypter.encrypt(file)) }
}

/**
 * The private key (`AGE-SECRET-KEY-1…`) out of an identity file, given the
 * passphrase. Only restoring needs this; the app itself never calls it.
 */
export async function unlockBackupKey(identity: string, passphrase: string): Promise<string> {
  const decrypter = new Decrypter()
  decrypter.addPassphrase(passphrase)
  const file = await decrypter.decrypt(armor.decode(identity), 'text')
  const secretKey = file.split('\n').find((line) => line.startsWith('AGE-SECRET-KEY-'))
  if (!secretKey) throw new Error('No private key in the backup key file')
  return secretKey
}

/**
 * `plain`, encrypted to `recipient` as a binary age file, as it streams.
 */
export async function encryptStream(recipient: string, plain: Readable): Promise<Readable> {
  const encrypter = new Encrypter()
  encrypter.addRecipient(recipient)
  const encrypted = await encrypter.encrypt(toWeb(plain))
  return Readable.fromWeb(encrypted as WebReadableStream<Uint8Array>)
}

/**
 * An age file decrypted with a private key, as it streams.
 */
export async function decryptStream(secretKey: string, encrypted: Readable): Promise<Readable> {
  const decrypter = new Decrypter()
  decrypter.addIdentity(secretKey)
  const plain = await decrypter.decrypt(toWeb(encrypted))
  return Readable.fromWeb(plain as WebReadableStream<Uint8Array>)
}

function toWeb(stream: Readable): ReadableStream<Uint8Array> {
  // Node streams yield Buffers, which are Uint8Arrays
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
}
