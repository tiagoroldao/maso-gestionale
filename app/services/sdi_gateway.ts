import { type DateTime } from 'luxon'
import type { SubmissionOutcome } from '#shared/invoice_lifecycle'
import type { SdiFailureCode } from '#shared/sdi_failures'

/**
 * A FatturaPA file ready to go to SDI.
 */
export type SdiFile = { fileName: string; xml: string }

/**
 * How a file is sent: with legal archiving (conservazione a norma)
 * requested from the intermediary. Openapi takes it exactly when its
 * account archives, and refuses it otherwise; with an account that
 * archives, it refuses a plain send too (ADR 0019).
 */
export type SubmitOptions = { legalArchiving: boolean }

/**
 * SDI's notice for a file sent through the intermediary: the outcome, the
 * notice's date (the resubmission deadline counts from it), SDI's
 * identifier for the file, and the error codes of a Rejection.
 */
export type SdiOutcomeReport = {
  outcome: SubmissionOutcome
  noticeOn: DateTime
  sdiId: string | null
  notes: string | null
}

/**
 * A Supplier Invoice file waiting at the intermediary.
 */
export type ReceivedRef = {
  remoteId: string
  receivedAt: DateTime
  sdiId: string | null
  fileName?: string | null
}

/**
 * A Supplier Invoice file as SDI delivered it: FatturaPA XML or a signed
 * .p7m.
 */
export type ReceivedFile = { fileName: string; content: Buffer }

/**
 * A received Supplier Invoice to hand to legal archiving (#214): its
 * FatturaPA XML as bytes (extracted from a signed .p7m), the name the
 * file came with, and SDI's identifier for it.
 */
export type ReceivedForArchiving = { fileName: string; xml: Buffer; sdiId: string }

/**
 * Where the intermediary should call when a Supplier Invoice arrives, for
 * our fiscal id. Polling stays the source of truth; the call only needs to
 * be registered for the intermediary to receive at all (ADR 0019).
 */
export type ReceivingCallback = { fiscalId: string; url: string; authHeader: string | null }

/**
 * The intermediary refused the file, so nothing reached SDI: it can be
 * sent again once the cause is fixed. Any other error from `submit` leaves
 * it unknown whether the file went.
 */
export class SdiSendRefusedError extends Error {}

/**
 * A failure the app names itself, by a code the pages translate.
 */
export class SdiFailure extends Error {
  constructor(readonly code: SdiFailureCode) {
    super(code)
  }
}

/**
 * How Submissions reach SDI and Supplier Invoices come back (ADR 0019).
 * The manual gateway relies on Office uploading files on the SDI portal
 * and recording outcomes by hand; an intermediary sends, reports outcomes
 * and receives. Polling is the source of truth: every method here is a
 * request the app makes, never a call it waits for.
 */
export interface SdiGateway {
  readonly channel: string
  /** Whether it sends files itself and reports their outcomes */
  readonly automatic: boolean
  /** Hands the file to SDI; the intermediary's id for it, if it has one */
  submit(file: SdiFile, options?: SubmitOptions): Promise<{ remoteId: string | null }>
  /** SDI's final notice for a file sent, or null while there is none */
  outcome(remoteId: string): Promise<SdiOutcomeReport | null>
  /** The ids of files already sent for an Invoice number and date, to settle an unknown send */
  findSent(invoice: { number: string; issuedOn: string }): Promise<string[]>
  /** Supplier Invoice files received since a moment (all of them for null) */
  received(since: DateTime | null): Promise<ReceivedRef[]>
  /** One received file */
  download(ref: ReceivedRef): Promise<ReceivedFile>
  /** Keeps the receiving callback registered as given; whether it had to change it */
  ensureReceiving(callback: ReceivingCallback): Promise<boolean>
  /**
   * Whether the intermediary's account archives (conservazione a norma)
   * what it sends and receives for the fiscal id: an account setting,
   * made outside the app (ADR 0019)
   */
  readLegalStorage(fiscalId: string): Promise<boolean>
  /**
   * Hands a Supplier Invoice that never went through the intermediary
   * (Office's upload) to legal archiving; the intermediary's id(s) for it
   * (one per invoice in the file)
   */
  archiveReceived(file: ReceivedForArchiving): Promise<{ remoteIds: string[] }>
}

/**
 * Office uploads the file themselves and confirms it in the app, so there
 * is nothing to send, poll or receive.
 */
export class ManualSdiGateway implements SdiGateway {
  readonly channel = 'manual'
  readonly automatic = false
  async submit() {
    return { remoteId: null }
  }
  async outcome() {
    return null
  }
  async findSent() {
    return []
  }
  async received() {
    return []
  }
  async download(): Promise<ReceivedFile> {
    throw new Error('Nothing is received without an intermediary')
  }
  async ensureReceiving() {
    return false
  }
  /** Nothing is archived without an intermediary: the business does it elsewhere */
  async readLegalStorage() {
    return false
  }
  async archiveReceived(): Promise<{ remoteIds: string[] }> {
    throw new Error('Nothing is archived without an intermediary')
  }
}

/**
 * An intermediary in memory, for tests: keeps what it is sent, answers
 * the outcomes and serves the files it is given. Its account doesn't
 * archive unless a test says so (`legalStorage`); like Openapi, it then
 * takes only sends with archiving requested, and otherwise only plain
 * ones.
 */
export class FakeSdiGateway implements SdiGateway {
  readonly channel = 'fake'
  readonly automatic = true
  /** Whether its account archives (`apply_legal_storage` at Openapi) */
  legalStorage = false
  /** The fiscal ids its account setting was read for */
  readonly legalStorageReads: string[] = []
  /** Makes the next read of the account setting fail with this error */
  failNextRead: Error | null = null
  /** Received Supplier Invoices handed to legal archiving */
  readonly archived: ReceivedForArchiving[] = []
  /** Makes the next archiving fail with this error */
  failNextArchive: Error | null = null
  /** Runs while an archiving is in flight, before it answers */
  duringArchive: (() => Promise<void>) | null = null
  readonly submitted: (SdiFile & SubmitOptions)[] = []
  readonly outcomes = new Map<string, SdiOutcomeReport>()
  readonly files = new Map<string, ReceivedFile & ReceivedRef>()
  /** Makes the next send fail with this error */
  failNext: Error | null = null

  async submit(file: SdiFile, options: SubmitOptions = { legalArchiving: false }) {
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }
    // Like Openapi: the account setting picks the one endpoint it takes
    if (options.legalArchiving !== this.legalStorage) {
      throw new SdiSendRefusedError(
        this.legalStorage ? 'Archiving is required here' : 'No legal archiving here'
      )
    }
    this.submitted.push({ ...file, legalArchiving: options.legalArchiving })
    return { remoteId: `fake-${this.submitted.length}` }
  }

  async outcome(remoteId: string) {
    return this.outcomes.get(remoteId) ?? null
  }

  async findSent() {
    return this.submitted.map((_, index) => `fake-${index + 1}`)
  }

  async received(since: DateTime | null) {
    return [...this.files.values()]
      .filter((file) => !since || file.receivedAt > since)
      .map(({ remoteId, receivedAt, sdiId }) => ({ remoteId, receivedAt, sdiId }))
  }

  async download(ref: ReceivedRef) {
    const file = this.files.get(ref.remoteId)!
    return { fileName: file.fileName, content: file.content }
  }

  /** The receiving callback registered, as the intermediary would keep it */
  receiving: ReceivingCallback | null = null

  async ensureReceiving(callback: ReceivingCallback) {
    const same = JSON.stringify(this.receiving) === JSON.stringify(callback)
    this.receiving = callback
    return !same
  }

  async readLegalStorage(fiscalId: string) {
    this.legalStorageReads.push(fiscalId)
    if (this.failNextRead) {
      const error = this.failNextRead
      this.failNextRead = null
      throw error
    }
    return this.legalStorage
  }

  async archiveReceived(file: ReceivedForArchiving) {
    if (this.duringArchive) await this.duringArchive()
    if (this.failNextArchive) {
      const error = this.failNextArchive
      this.failNextArchive = null
      throw error
    }
    if (!this.legalStorage) throw new Error('No legal archiving here')
    this.archived.push(file)
    return { remoteIds: [`fake-archive-${this.archived.length}`] }
  }
}
