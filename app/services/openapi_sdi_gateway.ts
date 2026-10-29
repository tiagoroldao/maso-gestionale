import { DateTime } from 'luxon'
import { TIME_ZONE } from '#shared/dates'
import type { SdiEnvironment } from '#shared/instance'
import type { SubmissionOutcome } from '#shared/invoice_lifecycle'
import {
  SdiSendRefusedError,
  type ReceivedRef,
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

type InvoiceRead = {
  uuid: string
  created_at: string
  sdi_file_name?: string | null
  sdi_file_id?: string | number | null
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
    if (!remoteId) throw new Error('Openapi accepted the file without giving its uuid')
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
   * GET /invoices?type=0 by number and date: the files Openapi holds for
   * that Invoice.
   */
  async findSent(invoice: { number: string; issuedOn: string }) {
    const invoices = await this.list({
      'type': '0',
      'invoiceNumber': invoice.number,
      'invoiceDate[after]': invoice.issuedOn,
      'invoiceDate[before]': invoice.issuedOn,
    })
    return invoices.map((found) => found.uuid)
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
   * A paged collection, read until a page comes back empty.
   */
  private async list(query: Record<string, string>) {
    const found: InvoiceRead[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const search = new URLSearchParams({ ...query, page: String(page) })
      const response = await this.request('GET', `/invoices?${search}`)
      const body = (await response.json()) as { data?: InvoiceRead[] | null }
      const rows = body.data ?? []
      if (!rows.length) break
      found.push(...rows)
    }
    return found
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
