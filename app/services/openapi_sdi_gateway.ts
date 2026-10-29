import { DateTime } from 'luxon'
import { TIME_ZONE } from '#shared/dates'
import type { SdiEnvironment } from '#shared/instance'
import type { SubmissionOutcome } from '#shared/invoice_lifecycle'
import {
  SdiFailure,
  SdiSendRefusedError,
  type ReceivedRef,
  type ReceivingCallback,
  type SdiFile,
  type SdiGateway,
  type SdiOutcomeReport,
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
type ApiConfiguration = {
  id?: string
  fiscal_id?: string
  callback?: (Callback & { provider_uuid?: string | null }) | null
}

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
   * POST /invoices with our own FatturaPA XML. Openapi answers the file's
   * uuid and queues it for SDI. A 4xx means it took nothing (invalid file,
   * no credit, token refused); anything else leaves it unknown.
   */
  async submit(file: SdiFile) {
    let response: Response
    try {
      response = await this.request('POST', '/invoices', {
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
    // One item per callback, each under a singular `callback` (the spec's
    // read shape); re-posted without Openapi's own `provider_uuid`
    const body = (await response.json()) as { data?: ApiConfiguration[] | null }
    const callbacks = (body.data ?? []).flatMap((configuration): Callback[] => {
      const read = configuration.callback
      if (!read?.event) return []
      const kept: Callback = { event: read.event, url: read.url }
      if (read.auth_header) kept.auth_header = read.auth_header
      if (read.field) kept.field = read.field
      return [kept]
    })
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
