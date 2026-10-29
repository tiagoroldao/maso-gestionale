import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { DateTime } from 'luxon'
import { buildFatturaPA, fatturaFileName } from '#fiscal/fattura_pa'
import { TIME_ZONE } from '#shared/dates'
import { invoiceLineTotal, invoiceTotals } from '#shared/invoice_totals'
import { extractXmlBytes, isSigned } from '#fiscal/fattura_pa_reader'
import { OPENAPI_BASE_URLS, OpenapiError, OpenapiSdiGateway } from '#services/openapi_sdi_gateway'
import {
  SdiFailure,
  SdiSendRefusedError,
  type ReceivedFile,
  type ReceivedRef,
} from '#services/sdi_gateway'

/**
 * The fiscal id the sandbox's Business Registry Configuration was made
 * with on 2026-10-29 (#92, `docs/follow-ups.md`)
 */
export const SANDBOX_FISCAL_ID = '02903752463'

/** The customer and supplier of the test documents: invented, checksum-valid */
const OTHER_PARTY_VAT = '11111111115'

/** A fiscal id no one can hold, to probe the `fiscal_id` filter */
const NOBODY = '00000000000'

/** How long a check waits for Openapi, unless `--wait` says otherwise */
export const DEFAULT_WAIT_SECONDS = 120

/**
 * How long receiving waits when the callback can't be delivered: the
 * sandbox listed such an invoice after about 7 minutes (ADR 0019)
 */
export const RECEIVE_WAIT_SECONDS = 600

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
  'apply_legal_storage',
  'downloaded',
  'event',
  'url',
  'notification',
])

/**
 * INCONCLUSIVE: the run can't show it (archiving not seen within the
 * wait), so it neither passes nor fails
 */
export type CheckResult = 'PASS' | 'FAIL' | 'SKIP' | 'INCONCLUSIVE'

/** Received files described in check 5's diagnostics, newest first */
const NEWEST_SHOWN = 3

/** Pages read at most, as the gateway reads them */
const MAX_PAGES = 50

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Collections whose second path segment is an id, hidden in the report */
const WITH_ID = new Set([
  'api_configurations',
  'business_registry_configurations',
  'invoices',
  'invoices_download',
  'invoices_notifications',
])

type Call = { line: string; shape: string }

type Check = {
  title: string
  result: CheckResult
  notes: string[]
  calls: Call[]
}

type Target = { baseUrl: string; fetch: typeof fetch }

type Raw = { status: number; body: any }

/** A file as `GET /invoices` lists it, as far as the checks read it */
type Listed = {
  uuid: string
  created_at?: string
  marking?: unknown
  downloaded?: unknown
  downloaded_at?: unknown
  recipient?: { business_vat_number_code?: string } | null
}

/** Left to Openapi's console: the check never deletes a registration (#223) */
const DELETING_REGISTRATIONS =
  "Deleting a Business Registry Configuration is left to Openapi's console; `--cleanup --fiscal-id <id>` removes only its callback configuration"

export type SandboxCheckOptions = {
  token: string
  fiscalId: string
  callbackUrl: string
  /** Create the Business Registry Configuration and the callback first */
  setup: boolean
  /**
   * How long to wait for Openapi to list or store something, in seconds;
   * null for the defaults (DEFAULT_WAIT_SECONDS, or RECEIVE_WAIT_SECONDS
   * for receiving with an undeliverable callback)
   */
  waitSeconds: number | null
  /** A signed file to try importing as it is (check 8) */
  p7mPath: string | null
  /**
   * With `setup`: a second fiscal id, registered with
   * `apply_legal_storage`, for checks 9 to 12
   */
  legalStorageFiscalId?: string | null
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
 * import of a received file; with a second, legal-storage registration,
 * how archiving follows `apply_legal_storage` (#223). It goes through the app's
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
  /** `apply_legal_storage` on the fiscal id's Business Registry Configuration, as read */
  private legalStorageFlag: unknown = undefined
  /** Whether the legal-storage registration is ready for checks 9 to 12 */
  private legalStorageReady = false

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
   * Runs the set-up (if asked) and checks 1 to 8, then 9 to 12 with a
   * legal-storage fiscal id; the Markdown report.
   */
  async run() {
    const legal = this.options.legalStorageFiscalId ?? null
    if (this.options.setup) {
      await this.check('Setup: Business Registry Configuration and callback', () => this.setup())
      if (legal) {
        await this.check('Setup: legal-storage Business Registry Configuration and callback', () =>
          this.setupLegalStorage(legal)
        )
      }
    }
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
    if (legal) {
      await this.check('9. A plain send is archived for a legal-storage registration', () =>
        this.legalPlainSend(legal)
      )
      await this.check('10. `/invoices_legal_storage` for a legal-storage registration', () =>
        this.legalEndpoint(legal)
      )
      await this.check('11. A received invoice is archived for a legal-storage registration', () =>
        this.legalReceived(legal)
      )
      await this.check(
        '12. Check 8 for a legal-storage registration: import an uploaded file',
        () => this.legalImport(legal)
      )
    }
    return this.report([
      ...(this.options.setup ? ['--setup'] : []),
      ...(legal ? [`--legal-storage-fiscal-id ${legal}`] : []),
    ])
  }

  /**
   * Removes the callback configurations for the fiscal id; the report.
   */
  async cleanup() {
    await this.check('Cleanup: callback configuration removed', async () => {
      const read = await this.raw('GET', `/api_configurations?${this.fiscalQuery()}`)
      if (notRegistered(read)) {
        return this.skip(`${this.options.fiscalId} is not registered: nothing to remove`)
      }
      if (read.status !== 200) return this.fail(`Couldn't read the configuration (${read.status})`)
      const items = asArray(read.body?.data) as { id?: string; fiscal_id?: string }[]
      // The read carries no fiscal id (ApiConfiguration-read): if Openapi
      // ignored the filter, these could be other fiscal ids' configurations
      const probe = await this.probeFilter()
      if (probe !== 'honoured') {
        return this.fail(
          `The \`fiscal_id\` filter is ${probe === 'ignored' ? 'ignored' : 'unconfirmed'}: nothing was removed`
        )
      }
      if (items.some((item) => item?.fiscal_id && item.fiscal_id !== this.options.fiscalId)) {
        return this.fail(
          'The configuration listed belongs to another fiscal id: nothing was removed'
        )
      }
      const ids = items.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
      if (!ids.length) return this.skip('No callback configuration to remove')
      const failed: string[] = []
      for (const id of ids) {
        const removed = await this.raw('DELETE', `/api_configurations/${encodeURIComponent(id)}`)
        if (removed.status < 200 || removed.status >= 300) failed.push(String(removed.status))
      }
      if (failed.length) return this.fail(`${failed.length} of ${ids.length} not removed`)
      this.note(DELETING_REGISTRATIONS)
      return this.pass(`${ids.length} configuration(s) removed`)
    })
    return this.report(['--cleanup', `--fiscal-id ${this.options.fiscalId}`])
  }

  /** Whether any check failed */
  get failed() {
    return this.checks.some((check) => check.result === 'FAIL')
  }

  // The checks: each answers its result, with notes

  private async setup() {
    if (!(await this.ensureRegistration(this.options.fiscalId, false))) return 'FAIL'
    await this.ensureCallback(this.options.fiscalId)
    return this.pass()
  }

  /**
   * A second Business Registry Configuration, with `apply_legal_storage`,
   * which Openapi sets only when one is created (#223)
   */
  private async setupLegalStorage(fiscalId: string) {
    if (!(await this.ensureRegistration(fiscalId, true))) return 'FAIL'
    await this.ensureCallback(fiscalId)
    await this.readByGateway(fiscalId)
    this.note(DELETING_REGISTRATIONS)
    this.legalStorageReady = true
    return this.pass()
  }

  /** Reads the fiscal id's Business Registry Configuration, or creates it; whether it is fit */
  private async ensureRegistration(fiscalId: string, legalStorage: boolean) {
    const existing = await this.raw(
      'GET',
      `/business_registry_configurations/${encodeURIComponent(fiscalId)}`
    )
    if (existing.status === 200) {
      const flag = existing.body?.data?.apply_legal_storage
      this.note(
        `Business Registry Configuration for ${fiscalId}: already there, \`apply_legal_storage\`: ${show(flag)}`
      )
      if (legalStorage && flag !== true) {
        this.fail(
          `${fiscalId} is registered without \`apply_legal_storage\`, which Openapi sets only when a registration is created: delete it in Openapi's console, or use another fiscal id`
        )
        return false
      }
      return true
    }
    if (existing.status !== 404) {
      this.fail(`Business Registry Configuration not readable (${existing.status})`)
      return false
    }
    const created = await this.raw('POST', '/business_registry_configurations', {
      fiscal_id: fiscalId,
      name: legalStorage ? 'Maso sandbox check, legal storage' : 'Maso sandbox check',
      email: 'sandbox-check@example.com',
      apply_signature: false,
      apply_legal_storage: legalStorage,
    })
    if (created.status < 200 || created.status >= 300) {
      this.fail(`Business Registry Configuration not created (${created.status})`)
      return false
    }
    this.note(
      `Business Registry Configuration for ${fiscalId}: created, \`apply_legal_storage\`: ${legalStorage}`
    )
    return true
  }

  /** The `supplier-invoice` callback, through the gateway as the app keeps it */
  private async ensureCallback(fiscalId: string) {
    const changed = await this.gateway.ensureReceiving({
      fiscalId,
      url: this.options.callbackUrl,
      authHeader: null,
    })
    this.note(
      `\`supplier-invoice\` callback to ${this.options.callbackUrl}: ${changed ? 'registered' : 'already registered'}`
    )
    if (deliverable(this.options.callbackUrl)) this.note(optionA(this.options.callbackUrl))
  }

  private async token() {
    const list = await this.raw('GET', '/business_registry_configurations')
    if (list.status === 401) return this.fail('The token is refused')
    if (list.status !== 200) return this.fail(`Unexpected answer (${list.status})`)
    const configured = asArray(list.body?.data).find(
      (item) => (item as { fiscal_id?: string })?.fiscal_id === this.options.fiscalId
    ) as { apply_legal_storage?: unknown } | undefined
    this.legalStorageFlag = configured?.apply_legal_storage
    this.note(
      configured
        ? `A Business Registry Configuration exists for ${this.options.fiscalId}, \`apply_legal_storage\`: ${show(this.legalStorageFlag)}`
        : `No Business Registry Configuration for ${this.options.fiscalId}: run with \`--setup\``
    )
    if (configured) await this.readByGateway(this.options.fiscalId)
    return this.pass()
  }

  /** The account setting as the app reads it (#224), noted */
  private async readByGateway(fiscalId: string) {
    try {
      const flag = await this.gateway.readLegalStorage(fiscalId)
      this.note(`\`readLegalStorage\` reads ${fiscalId} as ${flag ? 'archiving' : 'not archiving'}`)
    } catch (error) {
      this.note(
        `\`readLegalStorage\` couldn't read ${fiscalId}: ${error instanceof SdiFailure ? `\`${error.code}\`` : error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private async apiConfigurations() {
    const read = await this.raw('GET', `/api_configurations?${this.fiscalQuery()}`)
    if (notRegistered(read)) {
      return this.skip(`${this.options.fiscalId} is not registered: run with \`--setup\``)
    }
    if (read.status !== 200) return this.fail(`Unexpected answer (${read.status})`)
    const items = asArray(read.body?.data) as Record<string, unknown>[]
    this.note(
      `\`data\` is ${Array.isArray(read.body?.data) ? 'an array' : typeof read.body?.data}, ${items.length} item(s)`
    )
    const probe = await this.probeFilter()
    if (!items.length) {
      return probe === 'ignored'
        ? this.fail('The `fiscal_id` filter is ignored')
        : this.skip('No configuration to read: run with `--setup`')
    }

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
    if (probe === 'ignored') return this.fail('The `fiscal_id` filter is ignored')
    if (probe === 'unconfirmed') return this.fail("The `fiscal_id` filter couldn't be probed")
    return unknown
      ? this.fail(`${unknown} item(s) in a shape the gateway doesn't read`)
      : this.pass()
  }

  private async send(legalArchiving: boolean) {
    const number = `S${this.stamp}/${legalArchiving ? 2 : 1}`
    const progressive = `${legalArchiving ? 'B' : 'A'}${this.stamp.slice(-4)}`
    let uuid: string
    try {
      uuid = await this.submit(this.options.fiscalId, number, progressive, legalArchiving)
    } catch (error) {
      // Known (ADR 0019): the endpoint needs the registration's flag
      if (
        legalArchiving &&
        this.legalStorageFlag !== true &&
        error instanceof SdiSendRefusedError &&
        error.message.startsWith('Openapi 412:')
      ) {
        this.note(`Refused: ${error.message}`)
        return this.skip(
          `\`/invoices_legal_storage\` needs \`apply_legal_storage\` on the Business Registry Configuration (ADR 0019), here ${show(this.legalStorageFlag)}: checks 9 to 11 try a registration with it (\`--legal-storage-fiscal-id\`)`
        )
      }
      throw error
    }
    this.sent.push({ uuid, number })
    this.note(`Invoice ${number} sent; Openapi answered a uuid`)

    const search = await this.until(async () => {
      const uuids = await this.gateway.findSent({ number, issuedOn: this.today })
      return uuids.includes(uuid) ? uuids : null
    })
    const found = search.value

    // Read at once, so a file found while still queued shows as such
    const detail = await this.raw('GET', `/invoices/${uuid}`)
    const data = detail.body?.data ?? {}
    this.note(
      `${found ? 'Found by `findSent`' : 'Not found'} after ${search.attempts} attempt(s), ${search.seconds}s; \`marking\` then: ${show(data.marking)}`
    )
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
      return this.fail(`Not found by date and number (\`findSent\`) within ${this.wait}s`)
    }
    return this.pass(`${found.length} match(es) for the number`)
  }

  private async receive() {
    const since = this.startedAt.minus({ minutes: 1 })
    const earlier = await this.gateway.received(since)
    const before = new Set(earlier.map((ref) => ref.remoteId))
    const invoice = this.supplierInvoice(this.options.fiscalId, `F${this.stamp}`)
    const simulated = await this.raw('POST', '/simulate/supplier-invoice', invoice)
    this.note(simulation(invoice))
    if (simulated.status < 200 || simulated.status >= 300) {
      return this.fail(`The simulation was refused (${simulated.status})`)
    }
    this.note(optionA(this.callbackUrl))

    const wait = this.receiveWait
    const listing = await this.until(async () => {
      const refs = await this.gateway.received(since)
      return refs.find((candidate) => !before.has(candidate.remoteId)) ?? null
    }, wait)
    const ref = listing.value
    await this.describeReceived(ref?.remoteId ?? null)
    if (!ref) {
      return this.fail(`Not listed by \`GET /invoices?type=1\` within ${wait}s`)
    }
    this.note(`Listed after ${listing.attempts} attempt(s), ${listing.seconds}s`)
    const file = await this.gateway.download(ref)
    this.received = { ref, file }
    const signed = isSigned(file.content)
    this.note(
      `Listed, with ${ref.sdiId ? 'an' : 'no'} SDI id; downloaded ${file.content.length} bytes (${signed ? '.p7m' : 'XML'})`
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
        `${label}: ${listed} of ${ours.size} test invoices listed, ${ok ? 'as expected' : 'NOT as expected'}${rows.cut ? ` (cut off after ${MAX_PAGES} pages)` : ''}`
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
    const { value: report } = await this.until(() => this.gateway.outcome(sent.uuid))
    const detail = await this.raw('GET', `/invoices/${sent.uuid}`)
    this.note(`\`marking\` afterwards: ${show(detail.body?.data?.marking)}`)
    if (!report) {
      // Stored in the 2026-10-29 runs (ADR 0019), so no longer a known limitation
      return this.fail(`Not stored at \`GET /invoices_notifications/{uuid}\` within ${this.wait}s`)
    }
    this.note(`Read by the gateway as ${report.outcome}, with ${report.sdiId ? 'an' : 'no'} SDI id`)
    return report.outcome === 'delivered' ? this.pass() : this.fail(`Read as ${report.outcome}`)
  }

  /**
   * The received file goes through the gateway's `archiveReceived`, as
   * the app archives it (#214): a .p7m as its extracted XML. A .p7m, the
   * received one or `--p7m`, is also sent as it is in a raw call, to learn
   * whether Openapi takes it whole, under its own SDI id so it isn't a
   * repeat of the first import.
   */
  private async importReceived() {
    if (!this.received) return this.skip('Nothing was received (check 5)')
    const { ref, file } = this.received
    const signed = isSigned(file.content)
    let accepted = false
    // Known (ADR 0019): without `apply_legal_storage`, imports are refused with a 403
    let refusedForTheFlag = false
    try {
      const { remoteIds } = await this.gateway.archiveReceived({
        fileName: file.fileName,
        xml: extractXmlBytes(file.content),
        sdiId: ref.sdiId ?? this.stamp,
      })
      accepted = true
      this.note(
        `${file.fileName} (${signed ? 'XML extracted from the .p7m' : 'XML'}) through \`archiveReceived\`: accepted, ${remoteIds.length} uuid(s) read`
      )
    } catch (error) {
      this.note(`${file.fileName} through \`archiveReceived\`: refused (${importRefusal(error)})`)
      refusedForTheFlag =
        this.legalStorageFlag !== true && error instanceof OpenapiError && error.status === 403
    }

    if (signed) {
      await this.importAsItIs(file.content, file.fileName, 'received')
    } else if (this.options.p7mPath) {
      const content = await readFile(this.options.p7mPath)
      await this.importAsItIs(
        content,
        basename(this.options.p7mPath),
        `from \`--p7m\`; its buyer may not be ${this.options.fiscalId}`
      )
    } else {
      this.note('No .p7m tried as it is: pass one with `--p7m`')
    }
    if (refusedForTheFlag) {
      return this.skip(
        `Imports need \`apply_legal_storage\` on the Business Registry Configuration (ADR 0019), here ${show(this.legalStorageFlag)}: check 12 tries a registration with it (\`--legal-storage-fiscal-id\`)`
      )
    }
    return accepted ? this.pass() : this.fail('The received file was refused')
  }

  /** A raw call, since the gateway sends a .p7m as its extracted XML */
  private async importAsItIs(content: Buffer, fileName: string, origin: string) {
    const imported = await this.raw('POST', '/supplier_invoice_imports_legal_storage', {
      invoice: content.toString('base64'),
      invoice_file_name: fileName,
      sdi_id: `9${this.stamp}`,
    })
    const ok = imported.status >= 200 && imported.status < 300
    this.note(
      `${fileName} (.p7m as it is, ${origin}): ${ok ? 'accepted' : 'refused'} (${imported.status})`
    )
  }

  /**
   * Check 9: whether a plain `POST /invoices` is archived when the
   * registration has `apply_legal_storage`
   */
  private async legalPlainSend(fiscalId: string) {
    if (!this.legalStorageReady) return this.skip('The legal-storage registration is not ready')
    const number = `S${this.stamp}/3`
    const uuid = await this.submit(fiscalId, number, `C${this.stamp.slice(-4)}`, false)
    this.note(`Invoice ${number} sent from ${fiscalId} with plain \`POST /invoices\``)
    return this.archived(uuid, 'Archived after a plain send')
  }

  /** Check 10: whether the per-file endpoint is taken when the registration has the flag */
  private async legalEndpoint(fiscalId: string) {
    if (!this.legalStorageReady) return this.skip('The legal-storage registration is not ready')
    const number = `S${this.stamp}/4`
    let uuid: string
    try {
      uuid = await this.submit(fiscalId, number, `D${this.stamp.slice(-4)}`, true)
    } catch (error) {
      if (error instanceof SdiSendRefusedError) return this.fail(`Refused: ${error.message}`)
      throw error
    }
    const detail = await this.raw('GET', `/invoices/${uuid}`)
    const data = detail.body?.data ?? {}
    this.note(
      `Invoice ${number} accepted; \`legally_stored\`: ${show(data.legally_stored)}; \`preserved_document\`: ${kind(data.preserved_document)}`
    )
    return this.pass()
  }

  /** Check 11: whether a received invoice is archived when the registration has the flag */
  private async legalReceived(fiscalId: string) {
    if (!this.legalStorageReady) return this.skip('The legal-storage registration is not ready')
    const query = { 'type': '1', 'createdAt[after]': utc(this.startedAt.minus({ minutes: 1 })) }
    const earlier = await this.listAll(query)
    const before = new Set(earlier.map((row) => row.uuid))
    const invoice = this.supplierInvoice(fiscalId, `F${this.stamp}/L`)
    const simulated = await this.raw('POST', '/simulate/supplier-invoice', invoice)
    this.note(simulation(invoice))
    if (simulated.status < 200 || simulated.status >= 300) {
      return this.fail(`The simulation was refused (${simulated.status})`)
    }
    const wait = this.receiveWait
    const listing = await this.until(async () => {
      const rows = await this.listAll(query)
      // Check 5's invoice, listed late, is another fiscal id's
      return (
        rows.find((candidate) => {
          const code = candidate.recipient?.business_vat_number_code
          return !before.has(candidate.uuid) && (!code || code === fiscalId)
        }) ?? null
      )
    }, wait)
    const row = listing.value
    if (!row) {
      return this.fail(`Not listed by \`GET /invoices?type=1\` within ${wait}s`)
    }
    this.note(
      `Listed by \`GET /invoices?type=1\` after ${listing.attempts} attempt(s), ${listing.seconds}s`
    )
    return this.archived(row.uuid, 'Archived on receipt')
  }

  /**
   * Check 12: check 8 for a registration with `apply_legal_storage`. The
   * app imports only Office's uploads, which never went through Openapi
   * (#224, ADR 0019), so the file is one Openapi never saw: a test
   * FatturaPA from the supplier to the fiscal id, under an invented SDI id
   */
  private async legalImport(fiscalId: string) {
    if (!this.legalStorageReady) return this.skip('The legal-storage registration is not ready')
    const number = `F${this.stamp}/U`
    const progressive = `U${this.stamp.slice(-4)}`
    const fileName = fatturaFileName(OTHER_PARTY_VAT, progressive)
    try {
      const { remoteIds } = await this.gateway.archiveReceived({
        fileName,
        xml: Buffer.from(this.fattura(fiscalId, number, progressive, 'received')),
        sdiId: `8${this.stamp}`,
      })
      this.note(
        `Invoice ${number} to ${fiscalId}, never through Openapi, through \`archiveReceived\`: accepted, ${remoteIds.length} uuid(s) read`
      )
    } catch (error) {
      this.note(
        `Invoice ${number} to ${fiscalId} through \`archiveReceived\`: refused (${importRefusal(error)})`
      )
      return this.fail('The uploaded file was refused')
    }
    return this.pass()
  }

  /**
   * Waits for Openapi to mark a file `legally_stored`: PASS when it does,
   * INCONCLUSIVE when not within the wait, since archiving may come later
   */
  private async archived(uuid: string, archivedNote: string): Promise<CheckResult> {
    let last: Record<string, unknown> = {}
    const { value, seconds } = await this.until(async () => {
      const detail = await this.raw('GET', `/invoices/${uuid}`)
      last = detail.body?.data ?? {}
      return last.legally_stored === true ? last : null
    })
    this.note(
      `\`legally_stored\`: ${show(last.legally_stored)}; \`preserved_document\`: ${kind(last.preserved_document)} (after ${seconds}s)`
    )
    if (value) return this.pass(archivedNote)
    this.note(
      `Not marked \`legally_stored\` within ${this.wait}s: archiving may come later, so this neither confirms nor rules it out`
    )
    return 'INCONCLUSIVE'
  }

  /**
   * Check 5's diagnostics: what `GET /invoices?type=1` lists without
   * `createdAt`, and the newest few, values hidden
   */
  private async describeReceived(ours: string | null) {
    try {
      const rows = await this.listAll({ type: '1' })
      this.note(
        `Without \`createdAt\`, \`GET /invoices?type=1\` lists ${rows.length} received file(s)${rows.cut ? ` (cut off after ${MAX_PAGES} pages)` : ''}`
      )
      const newest = [...rows]
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .slice(0, NEWEST_SHOWN)
      for (const row of newest) {
        this.note(
          `${row.uuid === ours ? "This run's" : 'Listed'}: ${describeRow(row, this.options.fiscalId)}`
        )
      }
    } catch (error) {
      this.note(
        `Received files not listed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /** A test FatturaPA from the fiscal id, through the gateway; its uuid */
  private async submit(
    fiscalId: string,
    number: string,
    progressive: string,
    legalArchiving: boolean
  ) {
    const file = {
      fileName: fatturaFileName(fiscalId, progressive),
      xml: this.fattura(fiscalId, number, progressive),
    }
    const { remoteId } = await this.gateway.submit(file, { legalArchiving })
    return remoteId!
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

  private report(flags: string[]) {
    const counts = (['PASS', 'FAIL', 'SKIP', 'INCONCLUSIVE'] as const)
      .map((result) => `${this.checks.filter((check) => check.result === result).length} ${result}`)
      .join(', ')
    const lines = [
      '## Openapi sandbox check',
      '',
      `Run on ${this.startedAt.setZone(TIME_ZONE).toFormat('yyyy-MM-dd HH:mm')} (Europe/Rome) with \`node ace sdi:sandbox-check${flags.map((flag) => ` ${flag}`).join('')}\`, against \`${this.target.baseUrl}\` for fiscal id \`${this.options.fiscalId}\`, waiting up to ${this.wait}s${this.options.waitSeconds === null ? ` (${RECEIVE_WAIT_SECONDS}s to receive with an undeliverable callback)` : ''}. Values in answers are hidden but for ${[...SHOWN].map((key) => `\`${key}\``).join(', ')}.`,
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
    return this.redact(lines.join('\n') + '\n').replace(UUID, '{uuid}')
  }

  /** Never the token, wherever it might have come back */
  private redact(text: string) {
    const { token } = this.options
    if (!token) return text
    return text.replaceAll(token, '[token]').replaceAll(encodeURIComponent(token), '[token]')
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
    // A redirect could carry the token elsewhere
    const response = await this.target.fetch(url, { ...init, redirect: 'error' })
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
    const path = scrubPath(url.pathname)
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

  /**
   * `GET /invoices`, paged as the gateway pages it: until a page is empty
   * or `hasMore` is false, at most MAX_PAGES; `cut` when there was more
   */
  private async listAll(query: Record<string, string>) {
    const rows: Listed[] & { cut?: boolean } = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await this.raw(
        'GET',
        `/invoices?${new URLSearchParams({ ...query, page: String(page) })}`
      )
      if (list.status !== 200) throw new Error(`\`GET /invoices\` answered ${list.status}`)
      const data = asArray(list.body?.data) as Listed[]
      rows.push(...data)
      if (!data.length || list.body?.hasMore === false) return rows
    }
    rows.cut = true
    return rows
  }

  /** How long a check waits for Openapi, in seconds */
  private get wait() {
    return this.options.waitSeconds ?? DEFAULT_WAIT_SECONDS
  }

  /**
   * How long receiving waits: longer by default when the callback seen in
   * check 2 can't be delivered, since Openapi then lists the invoice only
   * after minutes (ADR 0019)
   */
  private get receiveWait() {
    if (this.options.waitSeconds !== null) return this.options.waitSeconds
    return this.callbackUrl && !deliverable(this.callbackUrl)
      ? RECEIVE_WAIT_SECONDS
      : DEFAULT_WAIT_SECONDS
  }

  /** Tries until it has an answer or the wait is over; the answer, attempts and seconds taken */
  private async until<T>(attempt: () => Promise<T | null>, waitSeconds = this.wait) {
    const start = Date.now()
    const deadline = start + waitSeconds * 1000
    for (let attempts = 1; ; attempts++) {
      const value = await attempt()
      const left = deadline - Date.now()
      if (value || left <= 0) {
        return { value: value || null, attempts, seconds: Math.round((Date.now() - start) / 1000) }
      }
      await sleep(Math.min(POLL_INTERVAL_MS, left))
    }
  }

  /**
   * Whether `GET /api_configurations` honours its `fiscal_id` filter: asked
   * for a fiscal id no one holds, it must list nothing. The read may carry
   * no fiscal id, so this is the only way to tell. Honoured for a 200
   * whose `data` is an empty array, or for the sandbox's 404 with error
   * 420 ("Fiscal ID not found or not registered"), which shows the filter
   * is validated (#223): any other answer proves nothing. It assumes the
   * filter treats every fiscal id the same way.
   */
  private async probeFilter(): Promise<'honoured' | 'ignored' | 'unconfirmed'> {
    const nobody = this.options.fiscalId === NOBODY ? '99999999999' : NOBODY
    const read = await this.raw(
      'GET',
      `/api_configurations?${new URLSearchParams({ fiscal_id: nobody })}`
    )
    const data = read.body?.data
    const listed = Array.isArray(data) ? data.length : 0
    if (notRegistered(read)) {
      this.note(
        `\`fiscal_id\` filter: honoured (fiscal id ${nobody}, which no one holds, answers 404 with error 420: the filter is validated)`
      )
      return 'honoured'
    }
    const result =
      read.status !== 200 || !Array.isArray(data) ? 'unconfirmed' : listed ? 'ignored' : 'honoured'
    this.note(
      `\`fiscal_id\` filter: ${
        result === 'unconfirmed'
          ? `unconfirmed (the probe answered ${read.status}, \`data\` ${kind(data)})`
          : `${result} (fiscal id ${nobody}, which no one holds, lists ${listed} item(s))`
      }`
    )
    return result
  }

  private fiscalQuery() {
    return new URLSearchParams({ fiscal_id: this.options.fiscalId })
  }

  // Test documents

  /** A FatturaPA file from the app's own builder, from the fiscal id to an invented customer */
  /**
   * A test FatturaPA: sent from the fiscal id, or received by it from the
   * invented supplier
   */
  private fattura(
    fiscalId: string,
    number: string,
    progressive: string,
    direction: 'sent' | 'received' = 'sent'
  ) {
    const received = direction === 'received'
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
        name: received ? 'Fornitore di prova' : 'Maso sandbox check',
        vatNumber: received ? OTHER_PARTY_VAT : fiscalId,
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
        name: received ? 'Maso sandbox check' : 'Cliente di prova',
        firstName: null,
        lastName: null,
        vatNumber: received ? fiscalId : OTHER_PARTY_VAT,
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
  private supplierInvoice(fiscalId: string, numero: string) {
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
            id_fiscale_iva: { id_paese: 'IT', id_codice: fiscalId },
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
              numero,
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

/** A request's path with ids hidden: `{uuid}`, or `{id}` for any other id */
function scrubPath(pathname: string) {
  const segments = pathname.split('/')
  // ['', collection, id?, …]
  if (segments.length > 2 && WITH_ID.has(segments[1]) && segments[2]) {
    segments[2] = new RegExp(`^${UUID.source}$`, 'i').test(segments[2]) ? '{uuid}' : '{id}'
  }
  return segments.join('/').replace(UUID, '{uuid}')
}

/** A sandbox answer for a fiscal id without a Business Registry Configuration */
function notRegistered(read: Raw) {
  return read.status === 404 && read.body?.error === 420
}

/** Whether Openapi could deliver to a callback URL: not the placeholder, nor any `.invalid` host */
function deliverable(callbackUrl: string) {
  let host = ''
  try {
    host = new URL(callbackUrl).hostname
  } catch {
    // Not a URL: Openapi can't deliver to it either
  }
  return !!host && host !== 'invalid' && !host.endsWith('.invalid')
}

/**
 * Whether check 5 answers option (a), "listable although the callback
 * can't be delivered": only with an undeliverable callback URL. With a
 * reachable one, the run tests delivery instead.
 */
function optionA(callbackUrl: string | null) {
  if (!callbackUrl) {
    return 'No `supplier-invoice` callback seen in check 2: this run does not answer option (a)'
  }
  return deliverable(callbackUrl)
    ? `**The \`supplier-invoice\` callback (${callbackUrl}) may be deliverable: this run tests delivery to it, not option (a)**`
    : `The \`supplier-invoice\` callback (${callbackUrl}) can't be delivered, so this answers option (a)`
}

type Party = { dati_anagrafici: { id_fiscale_iva: { id_paese: string; id_codice: string } } }

/** What a simulated Supplier Invoice was sent as: its keys, and whom it was for */
function simulation(invoice: {
  fattura_elettronica_header: {
    dati_trasmissione: { codice_destinatario: string }
    cedente_prestatore: Party
    cessionario_committente: Party
  }
}) {
  const header = invoice.fattura_elettronica_header
  const party = (who: Party) =>
    `${who.dati_anagrafici.id_fiscale_iva.id_paese}${who.dati_anagrafici.id_fiscale_iva.id_codice}`
  return `Simulated with a JSON body \`${outline(invoice)}\`: \`codice_destinatario\` ${header.dati_trasmissione.codice_destinatario}, buyer (\`cessionario_committente\`) ${party(header.cessionario_committente)}, supplier ${party(header.cedente_prestatore)}`
}

/** An object's keys, two levels deep, without values */
function outline(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return `[${value.length} × ${outline(value[0], depth)}]`
  if (!value || typeof value !== 'object') return ''
  const keys = Object.entries(value).map(([key, inner]) => {
    const below = depth < 1 ? outline(inner, depth + 1) : ''
    return below ? `${key}: ${below}` : key
  })
  return `{ ${keys.join(', ')} }`
}

/** A received file as listed, values hidden but for a few */
function describeRow(row: Listed, fiscalId: string) {
  const code = row.recipient?.business_vat_number_code
  const recipient = !code ? 'absent' : code === fiscalId ? 'our fiscal id' : 'another fiscal id'
  return `created ${row.created_at ?? 'absent'}, \`marking\` ${show(row.marking)}, \`downloaded\` ${show(row.downloaded)}, \`downloaded_at\` ${row.downloaded_at ? 'set' : 'absent'}, recipient ${recipient}`
}

/** Why an import was refused, for the report */
function importRefusal(error: unknown) {
  return error instanceof OpenapiError
    ? String(error.status)
    : error instanceof SdiFailure
      ? `\`${error.code}\`: no uuid read in the answer`
      : error instanceof Error
        ? error.message
        : String(error)
}
