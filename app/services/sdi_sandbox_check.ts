import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { DateTime } from 'luxon'
import { buildFatturaPA, fatturaFileName } from '#fiscal/fattura_pa'
import { TIME_ZONE } from '#shared/dates'
import { invoiceLineTotal, invoiceTotals } from '#shared/invoice_totals'
import { OPENAPI_BASE_URLS, OpenapiSdiGateway } from '#services/openapi_sdi_gateway'
import type { ReceivedFile, ReceivedRef } from '#services/sdi_gateway'

/**
 * The fiscal id the sandbox's Business Registry Configuration was made
 * with on 2026-10-29 (#92, `docs/follow-ups.md`)
 */
export const SANDBOX_FISCAL_ID = '02903752463'

/** The customer and supplier of the test documents: invented, checksum-valid */
const OTHER_PARTY_VAT = '11111111115'

/** How often a check asks again while it waits for Openapi */
const POLL_INTERVAL_MS = 5_000

/** Answer fields shown as they are; every other value shows only its type */
const SHOWN = new Set([
  'success',
  'message',
  'error',
  'marking',
  'type',
  'hasMore',
  'page',
  'itemsPerPage',
  'legally_stored',
  'event',
  'url',
  'notification',
])

export type CheckResult = 'PASS' | 'FAIL' | 'SKIP'

type Call = { line: string; shape: string }

type Check = {
  title: string
  result: CheckResult
  notes: string[]
  calls: Call[]
}

type Target = { baseUrl: string; fetch: typeof fetch }

type Raw = { status: number; body: any }

export type SandboxCheckOptions = {
  token: string
  fiscalId: string
  callbackUrl: string
  /** Create the Business Registry Configuration and the callback first */
  setup: boolean
  /** How long to wait for Openapi to list or store something, in seconds */
  waitSeconds: number
  /** A signed file to try importing as it is (check 8) */
  p7mPath: string | null
  /** A line about what is being done, for the person waiting */
  progress?: (line: string) => void
}

/**
 * A run against anything but Openapi's sandbox host.
 */
export class SandboxOnlyError extends Error {}

/**
 * Checks Openapi's sandbox against what the app assumes (ADR 0019, #204):
 * the token, the callback configuration's shape, sending, finding sent
 * files, legal archiving, receiving, the list filters, notices and the
 * import of a received file. It goes through the app's
 * `OpenapiSdiGateway` wherever the gateway has the call, and makes raw
 * calls only for the rest. The report is Markdown, with each call's status
 * and the shape of its answer (values hidden but for a few fields), and
 * never the token.
 */
export class SdiSandboxCheck {
  /** Where requests go: the sandbox, or a fake under test */
  static target: Target | null = null

  private readonly options: SandboxCheckOptions
  private readonly target: Target
  private readonly gateway: OpenapiSdiGateway
  private readonly checks: Check[] = []
  private current: Check | null = null
  private readonly startedAt = DateTime.now()
  private readonly stamp = this.startedAt.setZone(TIME_ZONE).toFormat('yyMMddHHmmss')
  private readonly today = this.startedAt.setZone(TIME_ZONE).toISODate()!

  /** What earlier checks leave for later ones */
  private sent: { uuid: string; number: string }[] = []
  private received: { ref: ReceivedRef; file: ReceivedFile } | null = null
  private callbackUrl: string | null = null

  constructor(options: SandboxCheckOptions) {
    this.options = options
    this.target = SdiSandboxCheck.target ?? {
      baseUrl: OPENAPI_BASE_URLS.sandbox,
      fetch: globalThis.fetch,
    }
    if (this.target.baseUrl !== OPENAPI_BASE_URLS.sandbox) {
      throw new SandboxOnlyError(
        `Refused: ${this.target.baseUrl} is not Openapi's sandbox (${OPENAPI_BASE_URLS.sandbox})`
      )
    }
    this.gateway = new OpenapiSdiGateway({
      token: options.token,
      environment: 'sandbox',
      fetch: this.recordingFetch,
    })
  }

  /**
   * Runs the set-up (if asked) and checks 1 to 8; the Markdown report.
   */
  async run() {
    if (this.options.setup)
      await this.check('Setup: Business Registry Configuration and callback', () => this.setup())
    await this.check('1. The token works', () => this.token())
    await this.check('2. `GET /api_configurations` shape', () => this.apiConfigurations())
    await this.check('3. Send, then find by date and number', () => this.send(false))
    await this.check('4. Send with legal storage, then find it', () => this.send(true))
    await this.check('5. A simulated Supplier Invoice is listed and downloaded', () =>
      this.receive()
    )
    await this.check('6. List filters are honoured; list order', () => this.filters())
    await this.check('7. A simulated RC is stored for polling', () => this.notification())
    await this.check('8. Import a received file to legal storage', () => this.importReceived())
    return this.report(this.options.setup ? '--setup' : null)
  }

  /**
   * Removes the callback configurations for the fiscal id; the report.
   */
  async cleanup() {
    await this.check('Cleanup: callback configuration removed', async () => {
      const read = await this.raw('GET', `/api_configurations?${this.fiscalQuery()}`)
      if (read.status !== 200) return this.fail(`Couldn't read the configuration (${read.status})`)
      const ids = (asArray(read.body?.data) as { id?: string }[])
        .map((item) => item?.id)
        .filter((id): id is string => typeof id === 'string')
      if (!ids.length) return this.skip('No callback configuration to remove')
      const failed: string[] = []
      for (const id of ids) {
        const removed = await this.raw('DELETE', `/api_configurations/${encodeURIComponent(id)}`)
        if (removed.status < 200 || removed.status >= 300) failed.push(String(removed.status))
      }
      if (failed.length) return this.fail(`${failed.length} of ${ids.length} not removed`)
      return this.pass(`${ids.length} configuration(s) removed`)
    })
    return this.report('--cleanup')
  }

  /** Whether any check failed */
  get failed() {
    return this.checks.some((check) => check.result === 'FAIL')
  }

  // The checks: each answers its result, with notes

  private async setup() {
    const fiscalId = this.options.fiscalId
    const existing = await this.raw(
      'GET',
      `/business_registry_configurations/${encodeURIComponent(fiscalId)}`
    )
    if (existing.status === 200) {
      this.note(`Business Registry Configuration for ${fiscalId}: already there`)
    } else if (existing.status === 404) {
      const created = await this.raw('POST', '/business_registry_configurations', {
        fiscal_id: fiscalId,
        name: 'Maso sandbox check',
        email: 'sandbox-check@example.com',
        apply_signature: false,
        apply_legal_storage: false,
      })
      if (created.status < 200 || created.status >= 300) {
        return this.fail(`Business Registry Configuration not created (${created.status})`)
      }
      this.note(`Business Registry Configuration for ${fiscalId}: created`)
    } else {
      return this.fail(`Business Registry Configuration not readable (${existing.status})`)
    }

    const changed = await this.gateway.ensureReceiving({
      fiscalId,
      url: this.options.callbackUrl,
      authHeader: null,
    })
    this.note(
      `\`supplier-invoice\` callback to ${this.options.callbackUrl}: ${changed ? 'registered' : 'already registered'}`
    )
    return this.pass()
  }

  private async token() {
    const list = await this.raw('GET', '/business_registry_configurations')
    if (list.status === 401) return this.fail('The token is refused')
    if (list.status !== 200) return this.fail(`Unexpected answer (${list.status})`)
    const configured = asArray(list.body?.data).some(
      (item) => (item as { fiscal_id?: string })?.fiscal_id === this.options.fiscalId
    )
    this.note(
      configured
        ? `A Business Registry Configuration exists for ${this.options.fiscalId}`
        : `No Business Registry Configuration for ${this.options.fiscalId}: run with \`--setup\``
    )
    return this.pass()
  }

  private async apiConfigurations() {
    const read = await this.raw('GET', `/api_configurations?${this.fiscalQuery()}`)
    if (read.status !== 200) return this.fail(`Unexpected answer (${read.status})`)
    const items = asArray(read.body?.data) as Record<string, unknown>[]
    this.note(
      `\`data\` is ${Array.isArray(read.body?.data) ? 'an array' : typeof read.body?.data}, ${items.length} item(s)`
    )
    if (!items.length) return this.skip('No configuration to read: run with `--setup`')

    let unknown = 0
    for (const [index, item] of items.entries()) {
      const forms = [
        'callback' in item ? `\`callback\` (${kind(item.callback)})` : null,
        'callbacks' in item ? `\`callbacks\` (${kind(item.callbacks)})` : null,
      ].filter(Boolean)
      if (!forms.length) unknown++
      this.note(`Item ${index + 1}: ${forms.join(' and ') || 'neither `callback` nor `callbacks`'}`)
      const callbacks = [...asArray(item.callbacks), ...asArray(item.callback)] as {
        event?: string
        url?: string
      }[]
      const receiving = callbacks.find((callback) => callback?.event === 'supplier-invoice')
      if (receiving?.url) this.callbackUrl = receiving.url
    }
    this.note(`\`supplier-invoice\` callback: ${this.callbackUrl ?? 'none'}`)
    return unknown
      ? this.fail(`${unknown} item(s) in a shape the gateway doesn't read`)
      : this.pass()
  }

  private async send(legalArchiving: boolean) {
    const number = `S${this.stamp}/${legalArchiving ? 2 : 1}`
    const progressive = `${legalArchiving ? 'B' : 'A'}${this.stamp.slice(-4)}`
    const file = {
      fileName: fatturaFileName(this.options.fiscalId, progressive),
      xml: this.fattura(number, progressive),
    }
    const { remoteId } = await this.gateway.submit(file, { legalArchiving })
    const uuid = remoteId!
    this.sent.push({ uuid, number })
    this.note(`Invoice ${number} sent as ${uuid}`)

    const found = await this.until(async () => {
      const uuids = await this.gateway.findSent({ number, issuedOn: this.today })
      return uuids.includes(uuid) ? uuids : null
    })

    const detail = await this.raw('GET', `/invoices/${uuid}`)
    const data = detail.body?.data ?? {}
    this.note(`\`marking\`: ${show(data.marking)}`)
    if (legalArchiving) {
      this.note(
        `\`legally_stored\`: ${show(data.legally_stored)}; \`preserved_document\`: ${kind(data.preserved_document)}`
      )
      const notices = await this.raw('GET', `/invoices_notifications/${uuid}`)
      this.note(`\`GET /invoices_notifications/{uuid}\` answers ${notices.status}`)
      const receipt = await this.raw('POST', '/simulate/legal-storage-receipt', { uuid })
      this.note(`Simulated \`legal-storage-receipt\`: ${receipt.status}`)
      const after = await this.raw('GET', `/invoices/${uuid}`)
      this.note(`\`legally_stored\` after it: ${show(after.body?.data?.legally_stored)}`)
      if (notices.status !== 200) return this.fail('Its notices are not readable for polling')
    }
    if (!found) {
      return this.fail(
        `Not found by date and number (\`findSent\`) within ${this.options.waitSeconds}s`
      )
    }
    return this.pass(`Found by \`findSent\` (${found.length} match(es))`)
  }

  private async receive() {
    const since = this.startedAt.minus({ minutes: 1 })
    const earlier = await this.gateway.received(since)
    const before = new Set(earlier.map((ref) => ref.remoteId))
    const simulated = await this.raw('POST', '/simulate/supplier-invoice', this.supplierInvoice())
    if (simulated.status < 200 || simulated.status >= 300) {
      return this.fail(`The simulation was refused (${simulated.status})`)
    }
    this.note(
      `\`supplier-invoice\` callback configured: ${this.callbackUrl ?? 'unknown (see check 2)'}`
    )

    const ref = await this.until(async () => {
      const refs = await this.gateway.received(since)
      return refs.find((candidate) => !before.has(candidate.remoteId)) ?? null
    })
    if (!ref) {
      return this.fail(`Not listed by \`GET /invoices?type=1\` within ${this.options.waitSeconds}s`)
    }
    const file = await this.gateway.download(ref)
    this.received = { ref, file }
    const signed = file.fileName.toLowerCase().endsWith('.p7m')
    this.note(
      `Listed as ${ref.remoteId}, SDI id ${ref.sdiId ?? 'none'}; downloaded ${file.content.length} bytes (${signed ? '.p7m' : 'XML'})`
    )
    return this.pass()
  }

  private async filters() {
    if (!this.sent.length) return this.skip('Nothing was sent (checks 3 and 4)')
    const ours = new Set(this.sent.map((sent) => sent.uuid))
    const failures: string[] = []
    const expect = async (label: string, query: Record<string, string>, present: boolean) => {
      const rows = await this.listAll(query)
      const listed = rows.filter((row) => ours.has(row.uuid)).length
      const ok = present ? listed === ours.size : listed === 0
      this.note(
        `${label}: ${listed} of ${ours.size} test invoices listed, ${ok ? 'as expected' : 'NOT as expected'}`
      )
      if (!ok) failures.push(label)
      return rows
    }

    const sameDay = await expect(
      `\`invoiceDate\` = today`,
      { 'type': '0', 'invoiceDate[after]': this.today, 'invoiceDate[before]': this.today },
      true
    )
    await expect(
      `\`invoiceDate\` in 2000`,
      { 'type': '0', 'invoiceDate[after]': '2000-01-01', 'invoiceDate[before]': '2000-01-02' },
      false
    )
    await expect(
      `\`createdAt[after]\` before the sends`,
      { 'type': '0', 'createdAt[after]': utc(this.startedAt.minus({ minutes: 1 })) },
      true
    )
    await expect(
      `\`createdAt[after]\` after the sends`,
      { 'type': '0', 'createdAt[after]': utc(DateTime.now().plus({ minutes: 1 })) },
      false
    )
    this.note(`Order of \`GET /invoices\`: ${order(sameDay)}`)

    if (this.received) {
      const { ref } = this.received
      const rows = async (after: DateTime) => {
        const listed = await this.listAll({ 'type': '1', 'createdAt[after]': utc(after) })
        return listed.some((row) => row.uuid === ref.remoteId)
      }
      const early = await rows(ref.receivedAt.minus({ minutes: 1 }))
      const late = await rows(ref.receivedAt.plus({ seconds: 1 }))
      const ok = early && !late
      this.note(
        `Received file by \`createdAt[after]\`: listed from a minute before (${early}), not from a second after (${late}), ${ok ? 'as expected' : 'NOT as expected'}`
      )
      if (!ok) failures.push('received `createdAt[after]`')
    } else {
      this.note('Received files not checked: nothing was received (check 5)')
    }
    return failures.length ? this.fail(`Not honoured: ${failures.join(', ')}`) : this.pass()
  }

  private async notification() {
    const sent = this.sent[0]
    if (!sent) return this.skip('Nothing was sent (check 3)')
    const simulated = await this.raw('POST', '/simulate/customer-notification', {
      uuid: sent.uuid,
      notification: 'RC',
    })
    if (simulated.status < 200 || simulated.status >= 300) {
      return this.fail(`The simulation was refused (${simulated.status})`)
    }
    const report = await this.until(() => this.gateway.outcome(sent.uuid))
    const detail = await this.raw('GET', `/invoices/${sent.uuid}`)
    this.note(`\`marking\` afterwards: ${show(detail.body?.data?.marking)}`)
    if (!report) {
      return this.fail(
        `Not stored at \`GET /invoices_notifications/{uuid}\` within ${this.options.waitSeconds}s`
      )
    }
    this.note(`Read by the gateway as ${report.outcome}, SDI id ${report.sdiId ?? 'none'}`)
    return report.outcome === 'delivered' ? this.pass() : this.fail(`Read as ${report.outcome}`)
  }

  /**
   * A raw call: the gateway has no method for this endpoint yet. Use the
   * gateway's once #214 adds one.
   */
  private async importReceived() {
    if (!this.received) return this.skip('Nothing was received (check 5)')
    const { ref, file } = this.received
    const imported = await this.raw('POST', '/supplier_invoice_imports_legal_storage', {
      invoice: file.content.toString('base64'),
      invoice_file_name: file.fileName,
      sdi_id: ref.sdiId ?? this.stamp,
    })
    const accepted = imported.status >= 200 && imported.status < 300
    const signed = file.fileName.toLowerCase().endsWith('.p7m')
    this.note(
      `${file.fileName} (${signed ? '.p7m' : 'XML'}): ${accepted ? 'accepted' : 'refused'} (${imported.status})`
    )

    if (signed) {
      this.note('The received file is a .p7m, tried as it is above')
    } else if (this.options.p7mPath) {
      const content = await readFile(this.options.p7mPath)
      const p7m = await this.raw('POST', '/supplier_invoice_imports_legal_storage', {
        invoice: content.toString('base64'),
        invoice_file_name: basename(this.options.p7mPath),
        sdi_id: `9${this.stamp}`,
      })
      const ok = p7m.status >= 200 && p7m.status < 300
      this.note(
        `${basename(this.options.p7mPath)} (.p7m, from \`--p7m\`): ${ok ? 'accepted' : 'refused'} (${p7m.status}); its buyer may not be ${this.options.fiscalId}`
      )
    } else {
      this.note('No .p7m tried: pass one with `--p7m`')
    }
    return accepted ? this.pass() : this.fail('The received file was refused')
  }

  // Running and reporting

  private async check(title: string, body: () => Promise<CheckResult>) {
    const check: Check = { title, result: 'SKIP', notes: [], calls: [] }
    this.checks.push(check)
    this.current = check
    this.options.progress?.(title)
    try {
      check.result = await body()
    } catch (error) {
      check.result = 'FAIL'
      check.notes.push(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.current = null
    }
  }

  private note(text: string) {
    this.current?.notes.push(text)
  }

  private pass(note?: string): CheckResult {
    if (note) this.note(note)
    return 'PASS'
  }

  private fail(note: string): CheckResult {
    this.note(note)
    return 'FAIL'
  }

  private skip(note: string): CheckResult {
    this.note(note)
    return 'SKIP'
  }

  private report(flag: '--setup' | '--cleanup' | null) {
    const counts = (['PASS', 'FAIL', 'SKIP'] as const)
      .map((result) => `${this.checks.filter((check) => check.result === result).length} ${result}`)
      .join(', ')
    const lines = [
      '## Openapi sandbox check',
      '',
      `Run on ${this.startedAt.setZone(TIME_ZONE).toFormat('yyyy-MM-dd HH:mm')} (Europe/Rome) with \`node ace sdi:sandbox-check${flag ? ` ${flag}` : ''}\`, against \`${this.target.baseUrl}\` for fiscal id \`${this.options.fiscalId}\`, waiting up to ${this.options.waitSeconds}s. Values in answers are hidden but for ${[...SHOWN].map((key) => `\`${key}\``).join(', ')}.`,
      '',
      '| Check | Result |',
      '| --- | --- |',
      ...this.checks.map((check) => `| ${check.title} | ${check.result} |`),
      '',
      `**${counts}**`,
    ]
    for (const check of this.checks) {
      lines.push('', `### ${check.title}: ${check.result}`, '')
      lines.push(...check.notes.map((note) => `- ${note}`))
      if (check.calls.length) {
        lines.push('', '<details><summary>Calls</summary>', '')
        for (const call of groupCalls(check.calls)) {
          lines.push(
            `- ${call.line}`,
            '',
            '  ```json',
            ...call.shape.split('\n').map((l) => `  ${l}`),
            '  ```'
          )
        }
        lines.push('', '</details>')
      }
    }
    return this.redact(lines.join('\n') + '\n')
  }

  /** Never the token, wherever it might have come back */
  private redact(text: string) {
    return this.options.token ? text.replaceAll(this.options.token, '[token]') : text
  }

  // Requests

  /**
   * Every request, the gateway's too: only to the sandbox, and recorded
   * as its status and the shape of its answer.
   */
  private readonly recordingFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.origin !== new URL(OPENAPI_BASE_URLS.sandbox).origin) {
      throw new SandboxOnlyError(`Refused a request to ${url.origin}`)
    }
    const response = await this.target.fetch(url, init)
    const copy = response.clone()
    const type = copy.headers.get('content-type') ?? ''
    let shape: string
    if (type.includes('json')) {
      const text = await copy.text()
      try {
        shape = JSON.stringify(shapeOf(JSON.parse(text)), null, 2)
      } catch {
        shape = JSON.stringify(`${text.length} characters, not JSON`)
      }
    } else {
      const bytes = await copy.arrayBuffer()
      shape = JSON.stringify(`${bytes.byteLength} bytes of ${type || 'unknown type'}`)
    }
    const path = url.pathname.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '{uuid}'
    )
    const query = url.search ? decodeURIComponent(url.search) : ''
    this.current?.calls.push({
      line: `\`${init?.method ?? 'GET'} ${path}${query}\` → ${response.status}`,
      shape,
    })
    return response
  }

  private async raw(method: 'GET' | 'POST' | 'DELETE', path: string, json?: unknown): Promise<Raw> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.token}`,
      Accept: 'application/json',
    }
    if (json !== undefined) headers['Content-Type'] = 'application/json'
    const response = await this.recordingFetch(`${OPENAPI_BASE_URLS.sandbox}${path}`, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      // Not JSON: no body to read
    }
    return { status: response.status, body }
  }

  /** `GET /invoices`, every page while there are more (at most 10) */
  private async listAll(query: Record<string, string>) {
    const rows: { uuid: string; created_at?: string }[] = []
    for (let page = 1; page <= 10; page++) {
      const list = await this.raw(
        'GET',
        `/invoices?${new URLSearchParams({ ...query, page: String(page) })}`
      )
      if (list.status !== 200) throw new Error(`\`GET /invoices\` answered ${list.status}`)
      const data = asArray(list.body?.data) as { uuid: string; created_at?: string }[]
      rows.push(...data)
      if (!data.length || list.body?.hasMore !== true) break
    }
    return rows
  }

  /** Tries until it has an answer or the wait is over */
  private async until<T>(attempt: () => Promise<T | null>): Promise<T | null> {
    const deadline = Date.now() + this.options.waitSeconds * 1000
    while (true) {
      const answer = await attempt()
      if (answer) return answer
      const left = deadline - Date.now()
      if (left <= 0) return null
      await sleep(Math.min(POLL_INTERVAL_MS, left))
    }
  }

  private fiscalQuery() {
    return new URLSearchParams({ fiscal_id: this.options.fiscalId })
  }

  // Test documents

  /** A FatturaPA file from the app's own builder, from the fiscal id to an invented customer */
  private fattura(number: string, progressive: string) {
    const line = {
      quantity: '1',
      unitPrice: '100',
      discountPercent: '0',
      vatRate: '22',
      natura: null,
    }
    return buildFatturaPA({
      progressive,
      documentType: 'TD01',
      number,
      issuedOn: this.today,
      dueOn: this.today,
      paymentMethod: null,
      credits: null,
      company: {
        name: 'Maso sandbox check',
        vatNumber: this.options.fiscalId,
        taxCode: null,
        taxRegime: 'RF01',
        street: 'Via di Qua',
        streetNumber: '1',
        postalCode: '38100',
        city: 'Trento',
        province: 'TN',
        email: null,
        phone: null,
        iban: null,
      },
      customer: {
        type: 'company',
        name: 'Cliente di prova',
        firstName: null,
        lastName: null,
        vatNumber: OTHER_PARTY_VAT,
        taxCode: null,
        sdiCode: '0000000',
        pec: null,
        street: 'Via di La',
        streetNumber: '2',
        postalCode: '38100',
        city: 'Trento',
        province: 'TN',
      },
      lines: [
        {
          ...line,
          description: 'Prova del sandbox',
          unit: null,
          lineTotal: invoiceLineTotal(line.quantity, line.unitPrice),
          legalNote: null,
        },
      ],
      totals: invoiceTotals([line]),
      globalDiscountPercent: '0',
      discountLabel: 'Sconto',
      notes: null,
    })
  }

  /** A Supplier Invoice to simulate, as JSON, addressed to the fiscal id */
  private supplierInvoice() {
    const address = {
      indirizzo: 'Via di La, 2',
      cap: '38100',
      comune: 'Trento',
      provincia: 'TN',
      nazione: 'IT',
    }
    return {
      fattura_elettronica_header: {
        dati_trasmissione: { codice_destinatario: 'JKKZDGR' },
        cedente_prestatore: {
          dati_anagrafici: {
            id_fiscale_iva: { id_paese: 'IT', id_codice: OTHER_PARTY_VAT },
            anagrafica: { denominazione: 'Fornitore di prova' },
            regime_fiscale: 'RF01',
          },
          sede: address,
        },
        cessionario_committente: {
          dati_anagrafici: {
            id_fiscale_iva: { id_paese: 'IT', id_codice: this.options.fiscalId },
            anagrafica: { denominazione: 'Maso sandbox check' },
          },
          sede: { ...address, indirizzo: 'Via di Qua, 1' },
        },
      },
      fattura_elettronica_body: [
        {
          dati_generali: {
            dati_generali_documento: {
              tipo_documento: 'TD01',
              divisa: 'EUR',
              data: this.today,
              numero: `F${this.stamp}`,
            },
          },
          dati_beni_servizi: {
            dettaglio_linee: [
              {
                numero_linea: 1,
                descrizione: 'Prova del sandbox',
                prezzo_unitario: '10.00',
                prezzo_totale: '10.00',
                aliquota_iva: '22.00',
              },
            ],
            dati_riepilogo: [
              { aliquota_iva: '22.00', imponibile_importo: '10.00', imposta: '2.20' },
            ],
          },
        },
      ],
    }
  }
}

/**
 * An answer with its values hidden, but for the fields in SHOWN: objects
 * keep their keys, arrays show their length and their first item.
 */
function shapeOf(value: unknown, key?: string, depth = 0): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    return value.length
      ? [`${value.length} item(s), the first:`, shapeOf(value[0], undefined, depth + 1)]
      : []
  }
  if (typeof value === 'object') {
    if (depth >= 5) return 'object'
    return Object.fromEntries(
      Object.entries(value).map(([name, inner]) => [name, shapeOf(inner, name, depth + 1)])
    )
  }
  if (key && SHOWN.has(key)) return typeof value === 'string' ? value.slice(0, 300) : value
  return typeof value
}

/** Calls in a row with the same line and shape, shown once with their count */
function groupCalls(calls: Call[]) {
  const grouped: (Call & { count: number })[] = []
  for (const call of calls) {
    const last = grouped.at(-1)
    if (last && last.line === call.line && last.shape === call.shape) last.count++
    else grouped.push({ ...call, count: 1 })
  }
  return grouped.map((call) => ({
    line: call.count > 1 ? `${call.line} (×${call.count})` : call.line,
    shape: call.shape,
  }))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : []
}

function kind(value: unknown) {
  return value === null || value === undefined
    ? 'absent'
    : Array.isArray(value)
      ? `array of ${value.length}`
      : typeof value
}

function show(value: unknown) {
  return value === undefined ? 'absent' : JSON.stringify(value)
}

/** A moment as the gateway writes it in `createdAt[after]` */
function utc(moment: DateTime) {
  return moment.toUTC().toISO()!
}

/** Whether a list comes oldest first, newest first, or neither */
function order(rows: { created_at?: string }[]) {
  const times = rows.map((row) => row.created_at).filter((time): time is string => !!time)
  if (times.length < 2) return `unknown (${times.length} row(s))`
  const ms = times.map((time) => DateTime.fromISO(time).toMillis())
  if (ms.every((time, index) => index === 0 || time >= ms[index - 1])) return 'oldest first'
  if (ms.every((time, index) => index === 0 || time <= ms[index - 1])) return 'newest first'
  return 'neither oldest nor newest first'
}
