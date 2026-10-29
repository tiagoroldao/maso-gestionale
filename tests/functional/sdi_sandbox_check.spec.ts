import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import ace from '@adonisjs/core/services/ace'
import env from '#start/env'
import { DateTime } from 'luxon'
import { OPENAPI_BASE_URLS } from '#services/openapi_sdi_gateway'
import { SANDBOX_FISCAL_ID, SdiSandboxCheck } from '#services/sdi_sandbox_check'
import { PLACEHOLDER_CALLBACK_URL } from '#services/sdi_receiving'
import { FakeOpenapi, type RecordedRequest } from '#tests/helpers/openapi'
import { extractXmlBytes } from '#fiscal/fattura_pa_reader'
import SdiSandboxCheckCommand from '../../commands/sdi_sandbox_check.js'

/** With characters that change when URL-encoded */
const TOKEN = 'sandbox+secret/token=4711'

const ANY_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** An invented, checksum-valid fiscal id for the legal-storage registration */
const LEGAL = '12345678903'

type Stored = {
  uuid: string
  type: 0 | 1
  created_at: string
  invoiceDate: string
  payload?: string
  legally_stored?: boolean
  sdi_file_name?: string
  sdi_file_id?: string
  recipient?: { business_vat_number_code: string }
  downloaded?: boolean
  downloaded_at?: string
}

/**
 * Openapi's sandbox in memory, as the 2026-10-29 runs showed it (ADR
 * 0019): it keeps what is sent and simulated, lists it by the filters
 * (unless told to ignore them), stores simulated notices for polling
 * (unless told not to), answers 404 with error 420 for an unregistered
 * fiscal id, and refuses `/invoices_legal_storage` (412) for a
 * registration without `apply_legal_storage`. A registration with it
 * archives what it sends and receives, unless `archives` is false.
 */
function fakeSandbox(
  options: {
    configured?: boolean
    /** `apply_legal_storage` on our fiscal id's registration, when configured */
    mainLegalStorage?: boolean
    /** Other registrations: fiscal id → `apply_legal_storage` */
    registrations?: Record<string, boolean>
    /** Whether a registration with `apply_legal_storage` gets its files `legally_stored` */
    archives?: boolean
    storesNotices?: boolean
    honoursFilters?: boolean
    /** Every list page says there is more */
    endlessPages?: boolean
    /** The callback configuration kept, when not the placeholder for our fiscal id */
    configuration?: { fiscal_id: string; callbacks: Record<string, unknown>[] }
    /** Lists every configuration whatever the `fiscal_id` asked, without `fiscal_id` (the spec's read) */
    ignoresFiscalIdFilter?: boolean
    /** The simulated Supplier Invoice is downloaded as this signed file, not XML */
    receivedP7m?: Buffer
  } = {}
) {
  const {
    configured = false,
    archives = true,
    storesNotices = true,
    honoursFilters = true,
    endlessPages = false,
  } = options
  const registries = new Map<string, boolean>(Object.entries(options.registrations ?? {}))
  if (configured) registries.set(SANDBOX_FISCAL_ID, options.mainLegalStorage ?? false)
  const openapi = new FakeOpenapi().keepsApiConfigurations(
    options.configuration ??
      (configured
        ? {
            fiscal_id: SANDBOX_FISCAL_ID,
            callbacks: [{ event: 'supplier-invoice', url: PLACEHOLDER_CALLBACK_URL }],
          }
        : null),
    'callback',
    options.ignoresFiscalIdFilter
      ? { honoursFilter: false, withFiscalId: false }
      : { honoursFilter: true, registered: (fiscalId) => registries.has(fiscalId) }
  )
  const invoices: Stored[] = []
  const notices = new Map<string, unknown[]>()
  const ok = (body: unknown, status = 200) => ({ status, body })
  let next = 0
  const created = () => DateTime.now().plus({ seconds: next }).toUTC().toISO()!
  const newUuid = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
  const archivedFor = (fiscalId: string) => (registries.get(fiscalId) && archives) || false

  const keep = (invoice: Stored) => {
    invoices.push(invoice)
    openapi.on('GET', `/invoices/${invoice.uuid}`, () =>
      ok({
        data: { ...invoice, marking: invoice.type ? 'received' : 'sent', preserved_document: null },
      })
    )
    openapi.on('GET', `/invoices_notifications/${invoice.uuid}`, () =>
      ok({ data: notices.get(invoice.uuid) ?? [], success: true })
    )
    if (invoice.type === 1) {
      openapi.on(
        'GET',
        `/invoices_download/${invoice.uuid}`,
        options.receivedP7m ? { status: 200, bytes: options.receivedP7m } : 'supplierInvoiceXml'
      )
    }
  }
  const send = (legalEndpoint: boolean) => (request: RecordedRequest) => {
    const sender = /<CedentePrestatore>[\s\S]*?<IdCodice>([^<]+)<\/IdCodice>/.exec(
      request.body!
    )![1]
    if (legalEndpoint && !registries.get(sender)) return 'legalStorageNotAllowed'
    const numero = /<Numero>([^<]+)<\/Numero>/.exec(request.body!)![1]
    const invoiceDate = /<Data>([^<]+)<\/Data>/.exec(request.body!)![1]
    const uuid = newUuid()
    keep({
      uuid,
      type: 0,
      created_at: created(),
      invoiceDate,
      payload: JSON.stringify({
        fattura_elettronica_body: [{ dati_generali: { dati_generali_documento: { numero } } }],
      }),
      // Through the endpoint, archived on the receipt (simulated)
      legally_stored: legalEndpoint
        ? false
        : registries.get(sender)
          ? archivedFor(sender)
          : undefined,
    })
    return ok({ data: { uuid }, message: 'Created 1  invoice', success: true, error: null })
  }
  const registration = (fiscalId: string) => () =>
    registries.has(fiscalId)
      ? ok({ data: { fiscal_id: fiscalId, apply_legal_storage: registries.get(fiscalId) } })
      : 'notFound'

  openapi
    .on('GET', '/business_registry_configurations', () =>
      ok({
        data: [...registries].map(([fiscalId, flag]) => ({
          fiscal_id: fiscalId,
          apply_legal_storage: flag,
        })),
        success: true,
      })
    )
    .on(
      'GET',
      `/business_registry_configurations/${SANDBOX_FISCAL_ID}`,
      registration(SANDBOX_FISCAL_ID)
    )
    .on('GET', `/business_registry_configurations/${LEGAL}`, registration(LEGAL))
    .on('POST', '/business_registry_configurations', (request) => {
      const body = JSON.parse(request.body!)
      registries.set(body.fiscal_id, body.apply_legal_storage)
      return ok({ data: { fiscal_id: body.fiscal_id }, success: true })
    })
    .on('DELETE', '/api_configurations/000000000000000000000000', () => ok({ success: true }))
    .on('POST', '/invoices', send(false))
    .on('POST', '/invoices_legal_storage', send(true))
    .on('GET', '/invoices', (request) => {
      const query = request.query
      const after = query.get('createdAt[after]')
      const rows = invoices.filter(
        (invoice) =>
          String(invoice.type) === query.get('type') &&
          (!honoursFilters ||
            ((!query.get('invoiceDate[after]') ||
              invoice.invoiceDate >= query.get('invoiceDate[after]')!) &&
              (!query.get('invoiceDate[before]') ||
                invoice.invoiceDate <= query.get('invoiceDate[before]')!) &&
              (!after || invoice.created_at >= DateTime.fromISO(after).toUTC().toISO()!)))
      )
      return ok({
        data:
          endlessPages || query.get('page') === '1'
            ? rows.map((row) => ({ ...row, marking: row.type ? 'received' : 'sent' }))
            : [],
        page: Number(query.get('page')),
        itemsPerPage: 10,
        hasMore: endlessPages,
        success: true,
      })
    })
    .on('POST', '/simulate/supplier-invoice', (request) => {
      const invoice = JSON.parse(request.body!)
      const buyer =
        invoice.fattura_elettronica_header.cessionario_committente.dati_anagrafici.id_fiscale_iva
          .id_codice
      if (!registries.has(buyer)) return 'recipientNotConfigured'
      keep({
        uuid: newUuid(),
        type: 1,
        created_at: created(),
        invoiceDate: invoice.fattura_elettronica_body[0].dati_generali.dati_generali_documento.data,
        sdi_file_name: `IT11111111115_00001.xml${options.receivedP7m ? '.p7m' : ''}`,
        sdi_file_id: '1084646898320',
        recipient: { business_vat_number_code: buyer },
        downloaded: true,
        downloaded_at: created(),
        legally_stored: archivedFor(buyer),
      })
      return ok({ success: true, message: 'simulate supplier_invoice sent', error: null })
    })
    .on('POST', '/simulate/customer-notification', (request) => {
      const { uuid, notification } = JSON.parse(request.body!)
      if (storesNotices) {
        notices.set(uuid, [
          { type: notification, created_at: created(), message: { identificativo_sdi: '4242' } },
        ])
      }
      return ok({ success: true, message: 'customer-notification sent', error: null })
    })
    .on('POST', '/simulate/legal-storage-receipt', (request) => {
      const { uuid } = JSON.parse(request.body!)
      invoices.find((invoice) => invoice.uuid === uuid)!.legally_stored = true
      return ok({ success: true, message: 'legal-storage-receipt sent', error: null })
    })
    .on('POST', '/supplier_invoice_imports_legal_storage', () => ok({ uuid: newUuid() }, 201))
  return openapi
}

/** Runs the command against the fake; its exit code, stdout and stderr */
async function run(
  openapi: FakeOpenapi,
  args: string[],
  baseUrl = OPENAPI_BASE_URLS.sandbox,
  wait = ['--wait=0']
) {
  const hosts: string[] = []
  const redirects: (string | undefined)[] = []
  SdiSandboxCheck.target = {
    baseUrl,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      hosts.push(new URL(String(input)).origin)
      redirects.push(init?.redirect)
      return openapi.fetch(input, init)
    }) as typeof fetch,
  }
  const command = await ace.create(SdiSandboxCheckCommand, [...wait, ...args])
  await command.exec()
  const logs = command.logger.getLogs()
  return {
    exitCode: command.exitCode,
    stdout: logs
      .filter((log) => log.stream === 'stdout')
      .map((log) => log.message)
      .join('\n'),
    stderr: logs
      .filter((log) => log.stream === 'stderr')
      .map((log) => log.message)
      .join('\n'),
    hosts,
    redirects,
  }
}

const posts = (openapi: FakeOpenapi, path: string) =>
  openapi.requests.filter((request) => request.method === 'POST' && request.path === path)

test.group('Openapi sandbox check (sdi:sandbox-check)', (group) => {
  group.each.setup(() => {
    ace.ui.switchMode('raw')
    // Set here, whatever .env holds, and put back after
    const kept = env.get('OPENAPI_SANDBOX_TOKEN')
    env.set('OPENAPI_SANDBOX_TOKEN', TOKEN)
    return () => {
      ace.ui.switchMode('normal')
      if (kept === undefined) {
        // Unset, not left empty: env.get falls back to process.env
        env.set('OPENAPI_SANDBOX_TOKEN', undefined as unknown as string)
        delete process.env.OPENAPI_SANDBOX_TOKEN
      } else {
        env.set('OPENAPI_SANDBOX_TOKEN', kept)
      }
      SdiSandboxCheck.target = null
    }
  })

  test('with --setup it configures the account, then every check passes', async ({ assert }) => {
    const openapi = fakeSandbox()

    const { exitCode, stdout, hosts, redirects } = await run(openapi, ['--setup'])

    assert.equal(exitCode, 0)
    assert.deepEqual([...new Set(hosts)], ['https://test.sdi.openapi.it'])
    // A redirect could carry the token elsewhere
    assert.deepEqual([...new Set(redirects)], ['error'])
    // The Business Registry Configuration and the placeholder callback
    assert.equal(
      JSON.parse(posts(openapi, '/business_registry_configurations')[0].body!).fiscal_id,
      SANDBOX_FISCAL_ID
    )
    assert.deepEqual(openapi.configurations, [
      {
        fiscal_id: SANDBOX_FISCAL_ID,
        callbacks: [{ event: 'supplier-invoice', url: PLACEHOLDER_CALLBACK_URL }],
      },
    ])
    for (const title of [
      'Setup: Business Registry Configuration and callback',
      '1. The token works',
      '2. `GET /api_configurations` shape',
      '3. Send, then find by date and number',
      '5. A simulated Supplier Invoice is listed and downloaded',
      '6. List filters are honoured; list order',
      '7. A simulated RC is stored for polling',
      '8. Import a received file to legal storage',
    ]) {
      assert.include(stdout, `| ${title} | PASS |`)
    }
    // Refused for a registration without `apply_legal_storage`, as known
    assert.include(stdout, '| 4. Send with legal storage, then find it | SKIP |')
    assert.include(stdout, 'Refused: Openapi 412: Your current configuration for this fiscal_id')
    assert.include(
      stdout,
      '`/invoices_legal_storage` needs `apply_legal_storage` on the Business Registry Configuration (ADR 0019), here false'
    )
    assert.include(stdout, '**8 PASS, 0 FAIL, 1 SKIP, 0 INCONCLUSIVE**')
    assert.include(stdout, 'Found by `findSent` after 1 attempt(s), 0s; `marking` then: "sent"')
    // The sandbox's 404 for a fiscal id no one holds: the filter is validated
    assert.include(
      stdout,
      '`fiscal_id` filter: honoured (fiscal id 00000000000, which no one holds, answers 404 with error 420: the filter is validated)'
    )
    assert.include(
      stdout,
      `The \`supplier-invoice\` callback (${PLACEHOLDER_CALLBACK_URL}) can't be delivered, so this answers option (a)`
    )
    // Check 5's diagnostics
    assert.include(
      stdout,
      'Simulated with a JSON body `{ fattura_elettronica_header: { dati_trasmissione, cedente_prestatore, cessionario_committente }, fattura_elettronica_body: [1 × { dati_generali, dati_beni_servizi }] }`: `codice_destinatario` JKKZDGR, buyer (`cessionario_committente`) IT02903752463, supplier IT11111111115'
    )
    assert.include(stdout, 'Listed after 1 attempt(s), 0s')
    assert.include(stdout, 'Without `createdAt`, `GET /invoices?type=1` lists 1 received file(s)')
    assert.match(
      stdout,
      /This run's: created \S+, `marking` "received", `downloaded` true, `downloaded_at` set, recipient our fiscal id/
    )
    // Ids hidden, as are values
    assert.notMatch(stdout, ANY_UUID)
    assert.notInclude(stdout, '1084646898320')
    assert.include(stdout, '`GET /invoices_download/{uuid}` → 200')
    // Through the app's gateway: XML sent as is, legal storage by endpoint
    assert.include(posts(openapi, '/invoices')[0].body!, '<FatturaElettronica')
    assert.lengthOf(posts(openapi, '/invoices_legal_storage'), 1)
    assert.include(stdout, 'Item 1: `callback` (object)')
    // The received file, imported as base64 with its name and SDI id
    const imported = JSON.parse(posts(openapi, '/supplier_invoice_imports_legal_storage')[0].body!)
    assert.deepEqual(
      { name: imported.invoice_file_name, sdiId: imported.sdi_id },
      { name: 'IT11111111115_00001.xml', sdiId: '1084646898320' }
    )
    assert.include(Buffer.from(imported.invoice, 'base64').toString(), '<FatturaElettronicaHeader>')
    assert.include(
      stdout,
      'IT11111111115_00001.xml (XML) through `archiveReceived`: accepted, 1 uuid(s) read'
    )
    assert.include(stdout, 'No .p7m tried as it is: pass one with `--p7m`')
    assert.notInclude(stdout, TOKEN)
    assert.notInclude(stdout, 'Bearer')
  })

  test('without --setup it changes no configuration; an unstored RC fails', async ({ assert }) => {
    const openapi = fakeSandbox({ configured: true, mainLegalStorage: true, storesNotices: false })

    const p7m = 'tests/fixtures/supplier_invoice.xml.p7m'
    const { exitCode, stdout } = await run(openapi, ['--p7m', p7m])

    // The sandbox stores simulated notices (ADR 0019): a failure when it doesn't
    assert.equal(exitCode, 1)
    assert.lengthOf(posts(openapi, '/business_registry_configurations'), 0)
    assert.lengthOf(posts(openapi, '/api_configurations'), 0)
    assert.notInclude(stdout, 'Setup:')
    assert.include(stdout, '| 7. A simulated RC is stored for polling | FAIL |')
    assert.include(stdout, 'Not stored at `GET /invoices_notifications/{uuid}` within 0s')
    assert.include(stdout, '**7 PASS, 1 FAIL, 0 SKIP, 0 INCONCLUSIVE**')
    // With `apply_legal_storage` on the registration, the endpoint is taken
    assert.include(
      stdout,
      'A Business Registry Configuration exists for 02903752463, `apply_legal_storage`: true'
    )
    // The app's own read of the flag (#224)
    assert.include(stdout, '`readLegalStorage` reads 02903752463 as archiving')
    assert.include(stdout, '| 4. Send with legal storage, then find it | PASS |')
    assert.include(stdout, '`legally_stored` after it: true')
    assert.include(stdout, 'Order of `GET /invoices`: oldest first')
    // The signed file is tried as it is, after the received one
    const [, signed] = posts(openapi, '/supplier_invoice_imports_legal_storage')
    const body = JSON.parse(signed.body!)
    assert.equal(body.invoice_file_name, 'supplier_invoice.xml.p7m')
    assert.deepEqual(Buffer.from(body.invoice, 'base64'), await readFile(p7m))
    assert.match(body.sdi_id, /^9\d{12}$/)
    assert.include(
      stdout,
      `supplier_invoice.xml.p7m (.p7m as it is, from \`--p7m\`; its buyer may not be ${SANDBOX_FISCAL_ID}): accepted (201)`
    )
  })

  test('check 8 imports a received .p7m as its XML, then tries it as it is', async ({ assert }) => {
    const p7m = await readFile('tests/fixtures/supplier_invoice.xml.p7m')
    const openapi = fakeSandbox({ configured: true, receivedP7m: p7m })

    const { exitCode, stdout } = await run(openapi, [])

    assert.equal(exitCode, 0)
    assert.include(stdout, '| 8. Import a received file to legal storage | PASS |')
    const [extracted, whole] = posts(openapi, '/supplier_invoice_imports_legal_storage').map(
      (request) => JSON.parse(request.body!)
    )
    // Through the gateway, as the app archives it
    assert.deepEqual(
      { name: extracted.invoice_file_name, sdiId: extracted.sdi_id },
      { name: 'IT11111111115_00001.xml.p7m', sdiId: '1084646898320' }
    )
    assert.deepEqual(Buffer.from(extracted.invoice, 'base64'), extractXmlBytes(p7m))
    // Then whole, under another SDI id
    assert.deepEqual(Buffer.from(whole.invoice, 'base64'), p7m)
    assert.match(whole.sdi_id, /^9\d{12}$/)
    assert.include(
      stdout,
      'IT11111111115_00001.xml.p7m (XML extracted from the .p7m) through `archiveReceived`: accepted, 1 uuid(s) read'
    )
    assert.include(stdout, 'IT11111111115_00001.xml.p7m (.p7m as it is, received): accepted (201)')
  })

  test('check 8 is skipped when refused for want of the flag, and fails when refused with it, or answering no uuid', async ({
    assert,
  }) => {
    // As the sandbox refused it on 2026-10-29, for a registration without the flag
    const refused = fakeSandbox({ configured: true }).on(
      'POST',
      '/supplier_invoice_imports_legal_storage',
      'importUseSupplierInvoiceImports'
    )
    const first = await run(refused, [])
    assert.equal(first.exitCode, 0)
    assert.include(first.stdout, '| 8. Import a received file to legal storage | SKIP |')
    assert.include(first.stdout, 'IT11111111115_00001.xml through `archiveReceived`: refused (403)')
    assert.include(first.stdout, 'Please use /supplier_invoice_imports for importing invoice')
    assert.include(first.stdout, 'check 12 tries a registration with it')

    // With the flag, the same refusal fails
    const flagged = fakeSandbox({ configured: true, mainLegalStorage: true }).on(
      'POST',
      '/supplier_invoice_imports_legal_storage',
      'importUseSupplierInvoiceImports'
    )
    const withFlag = await run(flagged, [])
    assert.equal(withFlag.exitCode, 1)
    assert.include(withFlag.stdout, '| 8. Import a received file to legal storage | FAIL |')

    const noUuid = fakeSandbox({ configured: true }).on(
      'POST',
      '/supplier_invoice_imports_legal_storage',
      { status: 201, body: { success: true } }
    )
    const second = await run(noUuid, [])
    assert.equal(second.exitCode, 1)
    assert.include(
      second.stdout,
      'IT11111111115_00001.xml through `archiveReceived`: refused (`noRemoteId`: no uuid read in the answer)'
    )
  })

  test('filters Openapi ignores fail check 6', async ({ assert }) => {
    const { exitCode, stdout } = await run(
      // With the flag, so both test invoices are sent
      fakeSandbox({ configured: true, mainLegalStorage: true, honoursFilters: false }),
      []
    )

    assert.equal(exitCode, 1)
    assert.include(stdout, '| 6. List filters are honoured; list order | FAIL |')
    assert.include(stdout, '`invoiceDate` in 2000: 2 of 2 test invoices listed, NOT as expected')
    assert.include(
      stdout,
      '`createdAt[after]` after the sends: 2 of 2 test invoices listed, NOT as expected'
    )
  })

  test('with no configuration, receiving fails and what depends on it is skipped', async ({
    assert,
  }) => {
    const { exitCode, stdout } = await run(fakeSandbox(), [])

    assert.equal(exitCode, 1)
    assert.include(stdout, 'run with `--setup`')
    assert.include(stdout, '| 2. `GET /api_configurations` shape | SKIP |')
    assert.include(stdout, '| 5. A simulated Supplier Invoice is listed and downloaded | FAIL |')
    assert.include(stdout, '| 8. Import a received file to legal storage | SKIP |')
  })

  test('--cleanup only removes the callback configuration', async ({ assert }) => {
    const openapi = fakeSandbox({ configured: true })

    const { exitCode, stdout } = await run(openapi, ['--cleanup'])

    assert.equal(exitCode, 0)
    assert.deepEqual(
      openapi.requests.map(
        (request) => `${request.method} ${request.path} ${request.query.get('fiscal_id') ?? ''}`
      ),
      [
        `GET /api_configurations ${SANDBOX_FISCAL_ID}`,
        // The filter probed with a fiscal id no one holds before removing
        'GET /api_configurations 00000000000',
        'DELETE /api_configurations/000000000000000000000000 ',
      ]
    )
    assert.include(stdout, '| Cleanup: callback configuration removed | PASS |')
    assert.include(stdout, '`DELETE /api_configurations/{id}` → 200')
    assert.notInclude(stdout, '000000000000000000000000')
  })

  test('--cleanup removes nothing when the fiscal id filter is ignored', async ({ assert }) => {
    // The account's one configuration is another fiscal id's, and the read
    // doesn't say whose it is (ApiConfiguration-read has no fiscal_id)
    const openapi = fakeSandbox({
      ignoresFiscalIdFilter: true,
      configuration: {
        fiscal_id: '00000000018',
        callbacks: [{ event: 'supplier-invoice', url: PLACEHOLDER_CALLBACK_URL }],
      },
    })

    const cleanup = await run(openapi, ['--cleanup'])

    assert.equal(cleanup.exitCode, 1)
    assert.include(cleanup.stdout, 'The `fiscal_id` filter is ignored: nothing was removed')
    assert.include(
      cleanup.stdout,
      '`fiscal_id` filter: ignored (fiscal id 00000000000, which no one holds, lists 1 item(s))'
    )
    assert.notInclude(
      openapi.requests.map((request) => request.method),
      'DELETE'
    )

    // Check 2 records the filter as ignored
    const checked = await run(openapi, [])
    assert.include(checked.stdout, '| 2. `GET /api_configurations` shape | FAIL |')
    assert.include(checked.stdout, 'The `fiscal_id` filter is ignored')
  })

  test('--cleanup removes nothing when the probe lists no array', async ({ assert }) => {
    for (const probe of [{ success: true }, { data: null, success: true }]) {
      const openapi = fakeSandbox({ configured: true }).on(
        'GET',
        '/api_configurations',
        (request) =>
          request.query.get('fiscal_id') === '00000000000'
            ? { status: 200, body: probe }
            : {
                status: 200,
                body: {
                  data: [
                    {
                      id: '000000000000000000000000',
                      callback: { event: 'supplier-invoice', url: PLACEHOLDER_CALLBACK_URL },
                    },
                  ],
                },
              }
      )

      const { exitCode, stdout } = await run(openapi, ['--cleanup'])

      assert.equal(exitCode, 1, JSON.stringify(probe))
      assert.include(stdout, 'The `fiscal_id` filter is unconfirmed: nothing was removed')
      assert.include(stdout, '`fiscal_id` filter: unconfirmed (the probe answered 200')
      assert.notInclude(
        openapi.requests.map((request) => request.method),
        'DELETE'
      )
    }
  })

  test('--cleanup removes nothing listed as another fiscal id', async ({ assert }) => {
    const openapi = fakeSandbox({
      configuration: {
        fiscal_id: '00000000018',
        callbacks: [{ event: 'supplier-invoice', url: PLACEHOLDER_CALLBACK_URL }],
      },
    })
    // Honoured for the probe, yet answering another fiscal id's for ours
    const configuration = openapi.on('GET', '/api_configurations', (request) =>
      request.query.get('fiscal_id') === '00000000000'
        ? { status: 200, body: { data: [], success: true } }
        : {
            status: 200,
            body: { data: [{ id: '000000000000000000000000', fiscal_id: '00000000018' }] },
          }
    )

    const { exitCode, stdout } = await run(configuration, ['--cleanup'])

    assert.equal(exitCode, 1)
    assert.include(stdout, 'belongs to another fiscal id: nothing was removed')
    assert.notInclude(
      openapi.requests.map((request) => request.method),
      'DELETE'
    )
  })

  test('check 5 says when the callback could be delivered, so option (a) is not answered', async ({
    assert,
  }) => {
    const url = 'https://maso.example.com/sdi/webhook'
    const openapi = fakeSandbox({
      configured: true,
      configuration: {
        fiscal_id: SANDBOX_FISCAL_ID,
        callbacks: [{ event: 'supplier-invoice', url }],
      },
    })

    const { stdout } = await run(openapi, [])

    assert.include(
      stdout,
      `**The \`supplier-invoice\` callback (${url}) may be deliverable: this run tests delivery to it, not option (a)**`
    )
  })

  test('lists are read like the gateway reads them, and a cut-off list is noted', async ({
    assert,
  }) => {
    const openapi = fakeSandbox({ configured: true, endlessPages: true })

    const { stdout } = await run(openapi, [])

    // The gateway fails rather than answer in part; check 6 says it was cut off
    assert.include(stdout, '| 3. Send, then find by date and number | FAIL |')
    assert.include(stdout, '(cut off after 50 pages)')
    // Up to the gateway's 50 pages, never further
    const pages = openapi.requests
      .filter((request) => request.path === '/invoices')
      .map((request) => Number(request.query.get('page')))
    assert.equal(Math.max(...pages), 50)
  })

  test('refuses any host but the sandbox, and runs without a token not at all', async ({
    assert,
  }) => {
    const openapi = fakeSandbox()

    const production = await run(openapi, ['--setup'], OPENAPI_BASE_URLS.production)
    assert.equal(production.exitCode, 1)
    assert.include(production.stderr, "https://sdi.openapi.it is not Openapi's sandbox")
    assert.equal(production.stdout, '')

    env.set('OPENAPI_SANDBOX_TOKEN', '')
    const tokenless = await run(openapi, [])
    assert.equal(tokenless.exitCode, 1)
    assert.include(tokenless.stderr, 'OPENAPI_SANDBOX_TOKEN is not set')

    assert.lengthOf(openapi.requests, 0)
  })

  test('never prints the token, even when Openapi echoes it', async ({ assert }) => {
    const openapi = fakeSandbox().on('GET', '/business_registry_configurations', (request) => ({
      status: 401,
      body: {
        success: false,
        message: `Wrong Token: ${request.headers['authorization']}, ${encodeURIComponent(TOKEN)}`,
        error: 125,
      },
    }))

    const { exitCode, stdout, stderr } = await run(openapi, [])

    assert.equal(exitCode, 1)
    assert.include(stdout, '| 1. The token works | FAIL |')
    assert.include(stdout, 'Wrong Token: Bearer [token], [token]')
    assert.notInclude(stdout, TOKEN)
    assert.notInclude(stdout, encodeURIComponent(TOKEN))
    assert.notInclude(stderr, TOKEN)
    assert.notInclude(stderr, encodeURIComponent(TOKEN))
  })

  test('receiving waits longer by default when the callback is undeliverable', async ({
    assert,
  }) => {
    // No --wait: the defaults
    const { exitCode, stdout } = await run(
      fakeSandbox({ configured: true }),
      [],
      OPENAPI_BASE_URLS.sandbox,
      []
    )

    assert.equal(exitCode, 0)
    assert.include(stdout, 'waiting up to 120s (600s to receive with an undeliverable callback)')
    assert.include(stdout, 'Listed after 1 attempt(s), 0s')
  })

  test('--legal-storage-fiscal-id registers a second fiscal id with apply_legal_storage, then checks archiving', async ({
    assert,
  }) => {
    const openapi = fakeSandbox()

    const { exitCode, stdout } = await run(openapi, ['--setup', '--legal-storage-fiscal-id', LEGAL])

    assert.equal(exitCode, 0)
    assert.include(
      stdout,
      `with \`node ace sdi:sandbox-check --setup --legal-storage-fiscal-id ${LEGAL}\``
    )
    // Created with the flag, which Openapi sets only then, and able to receive
    const [, legal] = posts(openapi, '/business_registry_configurations').map((request) =>
      JSON.parse(request.body!)
    )
    assert.deepInclude(legal, { fiscal_id: LEGAL, apply_legal_storage: true })
    assert.deepEqual(
      openapi.configurations.map((configuration) => configuration.fiscal_id),
      [SANDBOX_FISCAL_ID, LEGAL]
    )
    for (const title of [
      'Setup: legal-storage Business Registry Configuration and callback',
      '9. A plain send is archived for a legal-storage registration',
      '10. `/invoices_legal_storage` for a legal-storage registration',
      '11. A received invoice is archived for a legal-storage registration',
      '12. Check 8 for a legal-storage registration: import an uploaded file',
    ]) {
      assert.include(stdout, `| ${title} | PASS |`)
    }
    assert.include(
      stdout,
      `Business Registry Configuration for ${LEGAL}: created, \`apply_legal_storage\`: true`
    )
    assert.include(stdout, `\`readLegalStorage\` reads ${LEGAL} as archiving`)
    assert.include(
      stdout,
      "Deleting a Business Registry Configuration is left to Openapi's console"
    )
    assert.include(stdout, `Invoice S`)
    assert.include(stdout, `sent from ${LEGAL} with plain \`POST /invoices\``)
    assert.include(stdout, 'Archived after a plain send')
    assert.include(stdout, `buyer (\`cessionario_committente\`) IT${LEGAL}`)
    assert.include(stdout, 'Archived on receipt')
    // Sent from the legal-storage fiscal id, both ways
    const fromLegal = (path: string) =>
      posts(openapi, path).filter((request) => request.body!.includes(`<IdCodice>${LEGAL}`))
    assert.lengthOf(fromLegal('/invoices'), 1)
    assert.lengthOf(fromLegal('/invoices_legal_storage'), 1)
    // Check 12: a file to it from the supplier, which Openapi never saw
    const [, uploaded] = posts(openapi, '/supplier_invoice_imports_legal_storage').map((request) =>
      JSON.parse(request.body!)
    )
    const xml = Buffer.from(uploaded.invoice, 'base64').toString('utf8')
    assert.match(xml, new RegExp(`<CessionarioCommittente>[\\s\\S]*<IdCodice>${LEGAL}</IdCodice>`))
    assert.match(xml, /<CedentePrestatore>[\s\S]*?<IdCodice>11111111115<\/IdCodice>/)
    assert.match(uploaded.sdi_id, /^8\d{12}$/)
    assert.include(
      stdout,
      `to ${LEGAL}, never through Openapi, through \`archiveReceived\`: accepted, 1 uuid(s) read`
    )
  })

  test('the legal-storage checks report what Openapi refuses or does not archive', async ({
    assert,
  }) => {
    const openapi = fakeSandbox({
      configured: true,
      archives: false,
      registrations: { [LEGAL]: true },
    })
    openapi.on('POST', '/invoices_legal_storage', 'legalStorageNotAllowed')
    openapi.on('POST', '/supplier_invoice_imports_legal_storage', 'importUseSupplierInvoiceImports')

    const { exitCode, stdout } = await run(openapi, ['--setup', '--legal-storage-fiscal-id', LEGAL])

    assert.equal(exitCode, 1)
    assert.include(
      stdout,
      `Business Registry Configuration for ${LEGAL}: already there, \`apply_legal_storage\`: true`
    )
    assert.include(
      stdout,
      '| 9. A plain send is archived for a legal-storage registration | INCONCLUSIVE |'
    )
    assert.include(stdout, '`legally_stored`: false; `preserved_document`: absent (after 0s)')
    assert.include(stdout, 'Not marked `legally_stored` within 0s')
    assert.include(
      stdout,
      '| 10. `/invoices_legal_storage` for a legal-storage registration | FAIL |'
    )
    assert.include(stdout, 'Refused: Openapi 412')
    assert.include(
      stdout,
      '| 11. A received invoice is archived for a legal-storage registration | INCONCLUSIVE |'
    )
    assert.include(
      stdout,
      '| 12. Check 8 for a legal-storage registration: import an uploaded file | FAIL |'
    )
    assert.include(stdout, 'through `archiveReceived`: refused (403)')
  })

  test('a legal-storage fiscal id registered without the flag is refused, and its checks skipped', async ({
    assert,
  }) => {
    const openapi = fakeSandbox({ configured: true, registrations: { [LEGAL]: false } })

    const { exitCode, stdout } = await run(openapi, ['--setup', '--legal-storage-fiscal-id', LEGAL])

    assert.equal(exitCode, 1)
    assert.include(
      stdout,
      '| Setup: legal-storage Business Registry Configuration and callback | FAIL |'
    )
    assert.include(stdout, `${LEGAL} is registered without \`apply_legal_storage\``)
    assert.include(
      stdout,
      '| 9. A plain send is archived for a legal-storage registration | SKIP |'
    )
    assert.include(
      stdout,
      '| 11. A received invoice is archived for a legal-storage registration | SKIP |'
    )
    assert.include(
      stdout,
      '| 12. Check 8 for a legal-storage registration: import an uploaded file | SKIP |'
    )
    assert.lengthOf(posts(openapi, '/business_registry_configurations'), 0)
  })

  test('--legal-storage-fiscal-id needs --setup and another fiscal id', async ({ assert }) => {
    const openapi = fakeSandbox()

    for (const args of [
      ['--legal-storage-fiscal-id', LEGAL],
      ['--setup', '--legal-storage-fiscal-id', SANDBOX_FISCAL_ID],
    ]) {
      const { exitCode, stderr } = await run(openapi, args)
      assert.equal(exitCode, 1)
      assert.include(stderr, '--legal-storage-fiscal-id needs --setup')
    }
    assert.lengthOf(openapi.requests, 0)
  })

  test('--cleanup --fiscal-id removes the legal-storage fiscal id callback, not its registration', async ({
    assert,
  }) => {
    const openapi = fakeSandbox({
      registrations: { [LEGAL]: true },
      configuration: {
        fiscal_id: LEGAL,
        callbacks: [{ event: 'supplier-invoice', url: PLACEHOLDER_CALLBACK_URL }],
      },
    })

    const { exitCode, stdout } = await run(openapi, ['--cleanup', '--fiscal-id', LEGAL])

    assert.equal(exitCode, 0)
    assert.deepEqual(
      openapi.requests.map(
        (request) => `${request.method} ${request.path} ${request.query.get('fiscal_id') ?? ''}`
      ),
      [
        `GET /api_configurations ${LEGAL}`,
        'GET /api_configurations 00000000000',
        'DELETE /api_configurations/000000000000000000000000 ',
      ]
    )
    assert.include(stdout, `with \`node ace sdi:sandbox-check --cleanup --fiscal-id ${LEGAL}\``)
    assert.include(
      stdout,
      "Deleting a Business Registry Configuration is left to Openapi's console"
    )

    // A fiscal id not registered: nothing to remove
    const unregistered = await run(fakeSandbox(), ['--cleanup'])
    assert.equal(unregistered.exitCode, 0)
    assert.include(unregistered.stdout, `${SANDBOX_FISCAL_ID} is not registered: nothing to remove`)
  })
})
