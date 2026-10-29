import { type Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

/**
 * Where backups go (#33): an S3-compatible bucket.
 */
export interface BackupStore {
  /** Stores an object, replacing any with the same name */
  put(name: string, body: Readable | string): Promise<void>
  /** The names of the objects whose name starts with `prefix` */
  list(prefix: string): Promise<string[]>
  remove(name: string): Promise<void>
}

export type S3Config = {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Any S3-compatible object storage (AWS, Scaleway, OVH, Hetzner, MinIO…).
 */
export class S3BackupStore implements BackupStore {
  readonly #client: S3Client
  readonly #bucket: string

  constructor(config: S3Config) {
    this.#bucket = config.bucket
    this.#client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Bucket in the path, not the host name: what every provider accepts
      forcePathStyle: true,
      // Many S3-compatible providers refuse the newer default checksums
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  async put(name: string, body: Readable | string) {
    // Multipart for large archives, streamed without knowing the size
    await new Upload({
      client: this.#client,
      params: { Bucket: this.#bucket, Key: name, Body: body },
    }).done()
  }

  async list(prefix: string) {
    const names: string[] = []
    let token: string | undefined
    do {
      const page: ListObjectsV2CommandOutput = await this.#client.send(
        new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: prefix, ContinuationToken: token })
      )
      for (const object of page.Contents ?? []) if (object.Key) names.push(object.Key)
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return names
  }

  async remove(name: string) {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: name }))
  }
}

/**
 * Keeps objects in memory, for tests.
 */
export class FakeBackupStore implements BackupStore {
  readonly objects = new Map<string, Buffer>()
  /** Set to make every call fail with this message */
  failWith: string | null = null

  async put(name: string, body: Readable | string) {
    this.#check()
    this.objects.set(name, typeof body === 'string' ? Buffer.from(body) : await buffer(body))
  }

  async list(prefix: string) {
    this.#check()
    return [...this.objects.keys()].filter((name) => name.startsWith(prefix))
  }

  async remove(name: string) {
    this.#check()
    this.objects.delete(name)
  }

  #check() {
    if (this.failWith) throw new Error(this.failWith)
  }
}
