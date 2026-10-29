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

type Stored = {
  uuid: string
  type: 0 | 1
  created_at: string
  invoiceDate: string
  payload?: string
  legally_stored?: boolean
  sdi_file_name?: string
  sdi_file_id?: string
}

/**
 * Openapi's sandbox in memory: it keeps what is sent and simulated, lists
 * it by the filters (unless told to ignore them) and stores a simulated
 * notice for polling only when told to (the real sandbox doesn't, ADR 0019).
 */
function fakeSandbox(
  options: {
    configured?: boolean
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
    storesNotices = true,
    honoursFilters = true,
    endlessPages = false,
  } = options
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
      : { honoursFilter: true }
  )
  const registries: string[] = configured ? [SANDBOX_FISCAL_ID] : []
  const invoices: Stored[] = []
  const notices = new Map<string, unknown[]>()
  const ok = (body: unknown, status = 200) => ({ status, body })
  let next = 0
  const created = () => DateTime.now().plus({ seconds: next }).toUTC().toISO()!
  const newUuid = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`

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
  const send = (legallyStored: boolean) => (request: RecordedRequest) => {
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
      legally_stored: legallyStored ? false : undefined,
    })
    return ok({ data: { uuid }, message: 'Created 1  invoice', success: true, error: null })
  }

  openapi
    .on('GET', '/business_registry_configurations', () =>
      ok({ data: registries.map((fiscalId) => ({ fiscal_id: fiscalId })), success: true })
    )
    .on('GET', `/business_registry_configurations/${SANDBOX_FISCAL_ID}`, () =>
      registries.length ? ok({ data: { fiscal_id: SANDBOX_FISCAL_ID } }) : 'notFound'
    )
    .on('POST', '/business_registry_configurations', (request) => {
      registries.push(JSON.parse(request.body!).fiscal_id)
      return ok({ data: { fiscal_id: SANDBOX_FISCAL_ID }, success: true })
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
        data: endlessPages || query.get('page') === '1' ? rows : [],
        page: Number(query.get('page')),
        itemsPerPage: 10,
        hasMore: endlessPages,
        success: true,
      })
    })
    .on('POST', '/simulate/supplier-invoice', (request) => {
      if (!registries.length) return 'recipientNotConfigured'
      const invoice = JSON.parse(request.body!)
      keep({
        uuid: newUuid(),
        type: 1,
        created_at: created(),
        invoiceDate: invoice.fattura_elettronica_body[0].dati_generali.dati_generali_documento.data,
        sdi_file_name: `IT11111111115_00001.xml${options.receivedP7m ? '.p7m' : ''}`,
        sdi_file_id: '1084646898320',
      })
      return ok({ success: true, message: 'simulate supplier_invoice sended', error: null })
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
async function run(openapi: FakeOpenapi, args: string[], baseUrl = OPENAPI_BASE_URLS.sandbox) {
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
  const command = await ace.create(SdiSandboxCheckCommand, ['--wait=0', ...args])
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
    const kept = env.get('OPENAPI_SANDBOX_TOKEN') ?? ''
    env.set('OPENAPI_SANDBOX_TOKEN', TOKEN)
    return () => {
      ace.ui.switchMode('normal')
      env.set('OPENAPI_SANDBOX_TOKEN', kept)
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
      '4. Send with legal storage, then find it',
      '5. A simulated Supplier Invoice is listed and downloaded',
      '6. List filters are honoured; list order',
      '7. A simulated RC is stored for polling',
      '8. Import a received file to legal storage',
    ]) {
      assert.include(stdout, `| ${title} | PASS |`)
    }
    assert.include(stdout, '**9 PASS, 0 FAIL, 0 SKIP, 0 INCONCLUSIVE**')
    assert.include(stdout, 'Found by `findSent` after 1 attempt(s), 0s; `marking` then: "sent"')
    assert.include(
      stdout,
      '`fiscal_id` filter: honoured (fiscal id 00000000000, which no one holds, lists 0 item(s))'
    )
    assert.include(
      stdout,
      `The \`supplier-invoice\` callback (${PLACEHOLDER_CALLBACK_URL}) can't be delivered, so this answers option (a)`
    )
    // Ids hidden, as are values
    assert.notMatch(stdout, ANY_UUID)
    assert.notInclude(stdout, '1084646898320')
    assert.include(stdout, '`GET /invoices_download/{uuid}` → 200')
    // Through the app's gateway: XML sent as is, legal storage by endpoint
    assert.include(posts(openapi, '/invoices')[0].body!, '<FatturaElettronica')
    assert.lengthOf(posts(openapi, '/invoices_legal_storage'), 1)
    assert.include(stdout, 'Item 1: `callback` (object)')
    assert.include(stdout, '`legally_stored` after it: true')
    assert.include(stdout, 'Order of `GET /invoices`: oldest first')
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

  test('without --setup it changes no configuration; an unstored RC is inconclusive', async ({
    assert,
  }) => {
    const openapi = fakeSandbox({ configured: true, storesNotices: false })

    const p7m = 'tests/fixtures/supplier_invoice.xml.p7m'
    const { exitCode, stdout } = await run(openapi, ['--p7m', p7m])

    // As the real sandbox does (ADR 0019): not a failure
    assert.equal(exitCode, 0)
    assert.lengthOf(posts(openapi, '/business_registry_configurations'), 0)
    assert.lengthOf(posts(openapi, '/api_configurations'), 0)
    assert.notInclude(stdout, 'Setup:')
    assert.include(stdout, '| 7. A simulated RC is stored for polling | INCONCLUSIVE |')
    assert.include(stdout, 'Not stored at `GET /invoices_notifications/{uuid}` within 0s')
    assert.include(stdout, 'ADR 0019 records')
    assert.include(stdout, '**7 PASS, 0 FAIL, 0 SKIP, 1 INCONCLUSIVE**')
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

  test('check 8 fails when the import is refused, or answers no uuid', async ({ assert }) => {
    const refused = fakeSandbox({ configured: true }).on(
      'POST',
      '/supplier_invoice_imports_legal_storage',
      { status: 422, body: { success: false, message: 'Invalid invoice', error: 422 } }
    )
    const first = await run(refused, [])
    assert.equal(first.exitCode, 1)
    assert.include(first.stdout, '| 8. Import a received file to legal storage | FAIL |')
    assert.include(first.stdout, 'IT11111111115_00001.xml through `archiveReceived`: refused (422)')

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
      fakeSandbox({ configured: true, honoursFilters: false }),
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
      `**The \`supplier-invoice\` callback (${url}) may be deliverable: this run does NOT answer option (a)**`
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
})
