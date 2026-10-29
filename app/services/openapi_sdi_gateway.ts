import { DateTime } from 'luxon'
import { TIME_ZONE } from '#shared/dates'
import type { SdiEnvironment } from '#shared/instance'
import type { SubmissionOutcome } from '#shared/invoice_lifecycle'
import {
  SdiFailure,
  SdiSendRefusedError,
  type ReceivedForArchiving,
  type ReceivedRef,
  type ReceivingCallback,
  type SdiFile,
  type SdiGateway,
  type SdiOutcomeReport,
  type SubmitOptions,
} from '#services/sdi_gateway'

/** Openapi's SDI API, per environment (ADR 0019) */
export const OPENAPI_BASE_URLS: Record<SdiEnvironment, string> = {
  sandbox: 'https://test.sdi.openapi.it',
  production: 'https://sdi.openapi.it',
}

/**
 * The notices that close a Submission (B2B). A public administration's
 * acceptance (NE) and lapse (DT) come after RC and aren't modelled (#56).
 */
const FINAL_NOTICES: Record<string, SubmissionOutcome> = {
  NS: 'rejected',
  RC: 'delivered',
  MC: 'not_deliverable',
  AT: 'not_deliverable',
}

/** Received invoices pages read in one poll, at most */
const MAX_PAGES = 50

/** How long one request may take */
const TIMEOUT_MS = 30_000

/**
 * An answer from Openapi other than success.
 */
export class OpenapiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(`Openapi ${status}: ${message}`)
  }
}

type Fetch = typeof fetch

type Notification = {
  type?: string
  created_at?: string
  message?: {
    identificativo_sdi?: string | number | null
    lista_errori?: { Errore?: ErrorEntry | ErrorEntry[] } | null
    note?: string | null
  } | null
}
type ErrorEntry = { Codice?: string; Descrizione?: string }

/** The callback event for received Supplier Invoices */
const RECEIVING_EVENT = 'supplier-invoice'

type Callback = { event: string; url: string; auth_header?: string | null; field?: string | null }
/** A callback as read, with Openapi's read-only fields */
type ReadCallback = Callback & { id?: string | null; provider_uuid?: string | null }

/**
 * A configuration as `GET /api_configurations` may answer it. The spec's
 * schema says `callbacks` is an array, its example shows one object, and
 * its list response shows a singular `callback`; all three are read.
 */
type ApiConfiguration = {
  id?: string
  fiscal_id?: string
  callbacks?: ReadCallback[] | ReadCallback | null
  callback?: ReadCallback | null
}

/**
 * A configuration's callbacks as a list, in the write shape
 * (`{ event, url, auth_header, field }`), without read-only fields.
 */
function readCallbacks(configuration: ApiConfiguration): Callback[] {
  const many = configuration.callbacks
  const read = [
    ...(Array.isArray(many) ? many : many ? [many] : []),
    ...(configuration.callback ? [configuration.callback] : []),
  ]
  return read
    .filter((entry) => entry?.event && entry.url)
    .map((entry) => {
      const kept: Callback = { event: entry.event, url: entry.url }
      if (entry.auth_header) kept.auth_header = entry.auth_header
      if (entry.field) kept.field = entry.field
      return kept
    })
}

/** A Business Registry Configuration, as read */
type RegistryConfiguration = { fiscal_id?: string; apply_legal_storage?: unknown }

/** What an import answers: a uuid, or one per invoice in the file */
type ImportAnswer = { uuid?: string | string[] | null }

type InvoiceRead = {
  uuid: string
  created_at: string
  sdi_file_name?: string | null
  sdi_file_id?: string | number | null
  /** The invoice as JSON text, FatturaPA's fields in snake case */
  payload?: string | null
}

/**
 * Openapi as SDI intermediary (ADR 0019), through its REST API with a
 * Bearer token. Every call is made by the app, so an Instance that was
 * offline catches up on its next poll.
 */
export class OpenapiSdiGateway implements SdiGateway {
  readonly channel = 'openapi'
  readonly automatic = true
  readonly baseUrl: string
  private readonly token: string
  private readonly fetch: Fetch

  constructor(options: { token: string; environment: SdiEnvironment; fetch?: Fetch }) {
    this.token = options.token
    this.baseUrl = OPENAPI_BASE_URLS[options.environment]
    this.fetch = options.fetch ?? globalThis.fetch
  }

  /**
   * POST /invoices with our own FatturaPA XML, or POST
   * /invoices_legal_storage to have Openapi also hand it to legal
   * archiving. Openapi takes only the one its account setting allows
   * (`apply_legal_storage`), refusing the other with a 412 (sandbox, ADR
   * 0019). It answers the file's uuid and queues it for SDI. A 4xx means
   * it took nothing (invalid file, no credit, token refused, the other
   * endpoint); anything else leaves it unknown.
   */
  async submit(file: SdiFile, options: SubmitOptions = { legalArchiving: false }) {
    let response: Response
    try {
      const path = options.legalArchiving ? '/invoices_legal_storage' : '/invoices'
      response = await this.request('POST', path, {
        body: file.xml,
        contentType: 'application/xml',
      })
    } catch (error) {
      if (error instanceof OpenapiError && error.status >= 400 && error.status < 500) {
        throw new SdiSendRefusedError(error.message)
      }
      throw error
    }
    const body = (await response.json()) as { data?: { uuid?: string } }
    const remoteId = body.data?.uuid
    // Accepted, but with no id to follow it by: whether it went is unknown
    if (!remoteId) throw new SdiFailure('noRemoteId')
    return { remoteId }
  }

  /**
   * GET /invoices_notifications/{uuid}: the first notice that closes the
   * Submission, oldest first.
   */
  async outcome(remoteId: string): Promise<SdiOutcomeReport | null> {
    const response = await this.request(
      'GET',
      `/invoices_notifications/${encodeURIComponent(remoteId)}`
    )
    const body = (await response.json()) as { data?: Notification[] | null }
    const final = (body.data ?? [])
      .filter((notice) => notice.type && FINAL_NOTICES[notice.type] && notice.created_at)
      .sort((a, b) => a.created_at!.localeCompare(b.created_at!))[0]
    if (!final) return null

    const sdiId = final.message?.identificativo_sdi
    return {
      outcome: FINAL_NOTICES[final.type!],
      noticeOn: DateTime.fromISO(final.created_at!).setZone(TIME_ZONE).startOf('day'),
      sdiId: sdiId === null || sdiId === undefined ? null : String(sdiId).slice(0, 20),
      notes: final.type === 'NS' ? rejectionNotes(final) : null,
    }
  }

  /**
   * GET /invoices?type=0 on the Invoice's date: the files Openapi holds
   * with its number. Openapi ignores the `invoiceNumber` filter (seen in
   * the sandbox), so the number is matched here, from each file's payload.
   */
  async findSent(invoice: { number: string; issuedOn: string }) {
    const invoices = await this.list({
      'type': '0',
      'invoiceDate[after]': invoice.issuedOn,
      'invoiceDate[before]': invoice.issuedOn,
    })
    return invoices
      .filter((found) => payloadNumbers(found.payload).includes(invoice.number))
      .map((found) => found.uuid)
  }

  /**
   * GET /invoices?type=1: Supplier Invoices received, since a moment.
   */
  async received(since: DateTime | null): Promise<ReceivedRef[]> {
    const invoices = await this.list({
      type: '1',
      ...(since ? { 'createdAt[after]': since.toUTC().toISO()! } : {}),
    })
    return invoices.map((found) => ({
      remoteId: found.uuid,
      receivedAt: DateTime.fromISO(found.created_at),
      sdiId:
        found.sdi_file_id === null || found.sdi_file_id === undefined
          ? null
          : String(found.sdi_file_id).slice(0, 20),
      fileName: found.sdi_file_name ?? null,
    }))
  }

  /**
   * GET /invoices_download/{uuid} as application/octet-stream: the file as
   * SDI delivered it (XML or .p7m).
   */
  async download(ref: ReceivedRef) {
    const response = await this.request(
      'GET',
      `/invoices_download/${encodeURIComponent(ref.remoteId)}`,
      { accept: 'application/octet-stream' }
    )
    const content = Buffer.from(await response.arrayBuffer())
    return { fileName: ref.fileName || `${ref.remoteId}.xml`, content }
  }

  /**
   * Keeps the `supplier-invoice` callback registered: Openapi receives
   * Supplier Invoices only for a fiscal id with one (ADR 0019). Each POST
   * replaces the whole configuration, so it is read first, written only
   * when the callback differs, and keeps the callbacks of other events.
   */
  async ensureReceiving(callback: ReceivingCallback) {
    const search = new URLSearchParams({ fiscal_id: callback.fiscalId })
    const response = await this.request('GET', `/api_configurations?${search}`)
    // The read shape is unconfirmed (ADR 0019): every form the spec shows
    // is accepted, and re-posted as ApiConfiguration-write
    const body = (await response.json()) as { data?: ApiConfiguration[] | null }
    const callbacks = (body.data ?? []).flatMap(readCallbacks)
    const wanted: Callback = {
      event: RECEIVING_EVENT,
      url: callback.url,
      ...(callback.authHeader ? { auth_header: callback.authHeader } : {}),
    }
    const current = callbacks.find((entry) => entry.event === RECEIVING_EVENT)
    if (
      current &&
      current.url === wanted.url &&
      (current.auth_header ?? null) === (wanted.auth_header ?? null)
    ) {
      return false
    }

    const others = callbacks.filter((entry) => entry.event !== RECEIVING_EVENT)
    await this.request('POST', '/api_configurations', {
      body: JSON.stringify({ fiscal_id: callback.fiscalId, callbacks: [...others, wanted] }),
      contentType: 'application/json',
    })
    return true
  }

  /**
   * GET /business_registry_configurations/{fiscal_id}: whether the
   * account's Business Registry Configuration has `apply_legal_storage`,
   * which Openapi sets only when the configuration is created (ADR 0019).
   * The configuration is read as `{ data: { … } }`, or as a list of one.
   */
  async readLegalStorage(fiscalId: string) {
    const response = await this.request(
      'GET',
      `/business_registry_configurations/${encodeURIComponent(fiscalId)}`
    )
    const body = (await response.json()) as {
      data?: RegistryConfiguration | RegistryConfiguration[] | null
    }
    const configuration = Array.isArray(body.data) ? body.data[0] : body.data
    const flag = configuration?.apply_legal_storage
    if (typeof flag !== 'boolean') throw new SdiFailure('legalStorageUnread')
    return flag
  }

  /**
   * POST /supplier_invoice_imports_legal_storage: imports a Supplier
   * Invoice already received from SDI some other way (Office's upload)
   * into legal archiving (#214, ADR 0019). Openapi takes it only when its
   * account archives (`apply_legal_storage`): without, it answers 403. The spec takes the invoice XML in base64 (a .p7m is sent as its
   * extracted XML), with SDI's file name and identifier in place of the
   * metadata file, and answers its uuid, or an array of uuids for a file
   * with several invoices. The answer is read as the spec's `{ uuid }` or
   * as `{ data: { uuid } }`, the way Openapi answers its other POSTs: the
   * real shape is to confirm under #204.
   */
  async archiveReceived(file: ReceivedForArchiving) {
    const response = await this.request('POST', '/supplier_invoice_imports_legal_storage', {
      body: JSON.stringify({
        invoice: file.xml.toString('base64'),
        invoice_file_name: file.fileName,
        sdi_id: file.sdiId,
      }),
      contentType: 'application/json',
    })
    const body = (await response.json()) as ImportAnswer & { data?: ImportAnswer | null }
    const uuid = body.data?.uuid ?? body.uuid
    const remoteIds = (Array.isArray(uuid) ? uuid : [uuid]).filter(
      (id): id is string => typeof id === 'string' && id !== ''
    )
    if (!remoteIds.length) throw new SdiFailure('noRemoteId')
    return { remoteIds }
  }

  /**
   * A paged collection, read while Openapi says there is more. Past
   * MAX_PAGES it fails rather than answer in part: a partial list could
   * miss a sent file and make it look never sent.
   */
  private async list(query: Record<string, string>) {
    const found: InvoiceRead[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const search = new URLSearchParams({ ...query, page: String(page) })
      const response = await this.request('GET', `/invoices?${search}`)
      const body = (await response.json()) as {
        data?: InvoiceRead[] | null
        hasMore?: boolean
      }
      const rows = body.data ?? []
      found.push(...rows)
      if (!rows.length || body.hasMore === false) return found
    }
    throw new SdiFailure('tooManyPages')
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: string; contentType?: string; accept?: string } = {}
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: options.accept ?? 'application/json',
    }
    if (options.contentType) headers['Content-Type'] = options.contentType
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new OpenapiError(response.status, await errorMessage(response))
    return response
  }
}

/**
 * Openapi's error body is `{ success, message, error, data }`.
 */
async function errorMessage(response: Response) {
  const text = await response.text()
  try {
    const body = JSON.parse(text) as { message?: string }
    if (body.message) return body.message
  } catch {
    // Not JSON: the text itself
  }
  return text.slice(0, 500) || response.statusText
}

/**
 * The document numbers in an invoice's payload (one per body of a batch
 * file); none if it can't be read.
 */
function payloadNumbers(payload: string | null | undefined): string[] {
  try {
    const invoice = JSON.parse(payload ?? '') as {
      fattura_elettronica_body?: {
        dati_generali?: { dati_generali_documento?: { numero?: unknown } }
      }[]
    }
    return (invoice.fattura_elettronica_body ?? [])
      .map((body) => body.dati_generali?.dati_generali_documento?.numero)
      .filter((numero): numero is string => typeof numero === 'string')
  } catch {
    return []
  }
}

/**
 * A Rejection's error codes and descriptions, as Office records them by hand.
 */
function rejectionNotes(notice: Notification) {
  const errors = notice.message?.lista_errori?.Errore
  const list = Array.isArray(errors) ? errors : errors ? [errors] : []
  const notes = list
    .map((entry) => [entry.Codice, entry.Descrizione].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('; ')
  return notes || notice.message?.note || null
}
