import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { OpenapiError } from '#services/openapi_sdi_gateway'
import { SdiFailure, SdiSendRefusedError } from '#services/sdi_gateway'
import { FakeOpenapi, recorded } from '#tests/helpers/openapi'

const file = { fileName: 'IT01987654322_M0001.xml', xml: '<p:FatturaElettronica/>' }
const UUID = 'cb1e9d7b-a7f5-49f4-8abb-9111467891fd'

test.group('Openapi SDI gateway', () => {
  test('sends our own XML with the Bearer token and keeps the uuid', async ({ assert }) => {
    const openapi = new FakeOpenapi().on('POST', '/invoices', 'sent')

    const { remoteId } = await openapi.gateway().submit(file)

    assert.equal(remoteId, UUID)
    const [request] = openapi.requests
    assert.equal(request.method, 'POST')
    assert.equal(request.headers['authorization'], 'Bearer test-token')
    assert.equal(request.headers['content-type'], 'application/xml')
    assert.equal(request.body, file.xml)
  })

  test('the environment picks the sandbox or production', async ({ assert }) => {
    assert.equal(new FakeOpenapi().gateway('sandbox').baseUrl, 'https://test.sdi.openapi.it')
    assert.equal(new FakeOpenapi().gateway('production').baseUrl, 'https://sdi.openapi.it')
  })

  test('a 4xx means nothing was sent; other failures leave it unknown', async ({ assert }) => {
    for (const [answer, message] of [
      ['malformed', 'Parsing error: malformed XML'],
      ['noCredit', 'Insufficient Credit in Wallet'],
      ['wrongToken', 'Wrong Token'],
      ['noBusinessRegistry', 'No business registry configurations have been set up.'],
    ]) {
      const gateway = new FakeOpenapi().on('POST', '/invoices', answer).gateway()
      const error = await gateway.submit(file).catch((caught) => caught)
      assert.instanceOf(error, SdiSendRefusedError, answer)
      assert.include(error.message, message)
    }

    const failing = new FakeOpenapi().on('POST', '/invoices', 'unavailable').gateway()
    const unavailable = await failing.submit(file).catch((caught) => caught)
    assert.instanceOf(unavailable, OpenapiError)
    assert.notInstanceOf(unavailable, SdiSendRefusedError)
    assert.equal(unavailable.status, 500)

    const dropped = new FakeOpenapi()
      .on('POST', '/invoices', new TypeError('fetch failed'))
      .gateway()
    const lost = await dropped.submit(file).catch((caught) => caught)
    assert.notInstanceOf(lost, SdiSendRefusedError)
  })

  test("reads a Rejection's notice: date in Rome, SDI id and error codes", async ({ assert }) => {
    const openapi = new FakeOpenapi().on(
      'GET',
      `/invoices_notifications/${UUID}`,
      'notificationsRejected'
    )

    const report = await openapi.gateway().outcome(UUID)

    // 23:13 UTC on the 29th is already the 30th in Rome
    assert.deepEqual(
      { ...report!, noticeOn: report!.noticeOn.toISODate() },
      {
        outcome: 'rejected',
        noticeOn: '2026-10-30',
        sdiId: '111',
        notes: '00100 Certificato di firma scaduto',
      }
    )
  })

  test('a delivery receipt delivers; no notice yet is no outcome', async ({ assert }) => {
    const delivered = new FakeOpenapi()
      .on('GET', `/invoices_notifications/${UUID}`, 'notificationsDelivered')
      .gateway()
    const report = await delivered.outcome(UUID)
    assert.equal(report!.outcome, 'delivered')
    assert.equal(report!.sdiId, '4242')
    assert.isNull(report!.notes)

    const waiting = new FakeOpenapi()
      .on('GET', `/invoices_notifications/${UUID}`, 'notificationsNone')
      .gateway()
    assert.isNull(await waiting.outcome(UUID))
  })

  test('lists received Supplier Invoices page by page, since a moment', async ({ assert }) => {
    // Recorded page shape: data, page, itemsPerPage, hasMore
    const pages = recorded('receivedPage1')
    const [first, second] = pages.body.data
    const openapi = new FakeOpenapi().on('GET', '/invoices', (request) => {
      const page = request.query.get('page') === '1'
      return {
        status: 200,
        body: { ...pages.body, data: [page ? first : second], hasMore: page },
      }
    })
    const since = DateTime.fromISO('2026-10-01T00:00:00Z')

    const refs = await openapi.gateway().received(since)

    assert.deepEqual(
      refs.map((ref) => [ref.remoteId, ref.fileName, ref.sdiId]),
      [
        ['9b8dddbd-7900-48c6-b159-0f60cc9b413c', 'IT12345678901_00001.xml', '1084646898320'],
        ['ffe8cdad-1a02-49fe-8cc6-f6b189eb6e5d', 'IT12345678901_00002.xml.p7m', '335228642533'],
      ]
    )
    // Stops when Openapi says there is no more
    assert.lengthOf(openapi.requests, 2)
    assert.equal(openapi.requests[0].query.get('type'), '1')
    assert.equal(openapi.requests[0].query.get('createdAt[after]'), '2026-10-01T00:00:00.000Z')
    assert.equal(openapi.requests[1].query.get('page'), '2')
  })

  test('downloads a received file as delivered', async ({ assert }) => {
    const openapi = new FakeOpenapi().on(
      'GET',
      '/invoices_download/9b8dddbd-7900-48c6-b159-0f60cc9b413c',
      'supplierInvoiceXml'
    )

    const received = await openapi.gateway().download({
      remoteId: '9b8dddbd-7900-48c6-b159-0f60cc9b413c',
      receivedAt: DateTime.now(),
      sdiId: null,
      fileName: 'IT12345678901_00001.xml',
    })

    assert.equal(received.fileName, 'IT12345678901_00001.xml')
    assert.include(received.content.toString('utf8'), '<Numero>1</Numero>')
    assert.equal(openapi.requests[0].headers['accept'], 'application/octet-stream')
  })

  test('finds the files sent for an Invoice by its date, matching the number itself', async ({
    assert,
  }) => {
    // The recorded sandbox list holds Invoice 92/2026 of 29 October 2026
    const openapi = new FakeOpenapi().on('GET', '/invoices', 'sentList')
    const gateway = openapi.gateway()

    assert.deepEqual(await gateway.findSent({ number: '92/2026', issuedOn: '2026-10-29' }), [UUID])
    // Openapi ignores invoiceNumber, so another number on that day finds nothing
    assert.deepEqual(await gateway.findSent({ number: '93/2026', issuedOn: '2026-10-29' }), [])

    const query = openapi.requests[0].query
    assert.equal(query.get('type'), '0')
    assert.isNull(query.get('invoiceNumber'))
    assert.equal(query.get('invoiceDate[after]'), '2026-10-29')
    assert.equal(query.get('invoiceDate[before]'), '2026-10-29')
    // One page: hasMore is false
    assert.lengthOf(openapi.requests, 2)
  })

  test('registers the receiving callback only when it differs', async ({ assert }) => {
    const openapi = new FakeOpenapi().keepsApiConfigurations()
    const gateway = openapi.gateway()
    const callback = {
      fiscalId: '00000000000',
      url: 'https://invalid.invalid/sdi/webhook',
      authHeader: null,
    }

    assert.isTrue(await gateway.ensureReceiving(callback))
    assert.isFalse(await gateway.ensureReceiving(callback))
    assert.isTrue(
      await gateway.ensureReceiving({ ...callback, url: 'https://maso.example.it/sdi/webhook' })
    )

    assert.deepEqual(openapi.configurations, [
      {
        fiscal_id: '00000000000',
        callbacks: [{ event: 'supplier-invoice', url: 'https://invalid.invalid/sdi/webhook' }],
      },
      {
        fiscal_id: '00000000000',
        callbacks: [{ event: 'supplier-invoice', url: 'https://maso.example.it/sdi/webhook' }],
      },
    ])
    const read = openapi.requests.find((request) => request.method === 'GET')!
    assert.equal(read.query.get('fiscal_id'), '00000000000')
    assert.equal(read.headers['authorization'], 'Bearer test-token')
  })

  test("reads the spec's configuration shape: an unchanged callback isn't written", async ({
    assert,
  }) => {
    // One item per callback, under a singular `callback`, with provider_uuid
    const openapi = new FakeOpenapi().on('GET', '/api_configurations', 'apiConfigurationsOne')

    const changed = await openapi.gateway().ensureReceiving({
      fiscalId: 'OPENAPI1234',
      url: 'https://dev.console.openapi.com',
      authHeader: 'Test 22345',
    })

    assert.isFalse(changed)
    assert.deepEqual(
      openapi.requests.map((request) => request.method),
      ['GET']
    )
  })

  test('a callback set by hand for another event survives, without provider_uuid', async ({
    assert,
  }) => {
    const notification = {
      event: 'customer-notification',
      url: 'https://elsewhere.example/hook',
      auth_header: 'Bearer by-hand',
      field: 'data',
    }
    const openapi = new FakeOpenapi().keepsApiConfigurations({
      fiscal_id: '00000000000',
      callbacks: [notification],
    })

    await openapi.gateway().ensureReceiving({
      fiscalId: '00000000000',
      url: 'https://invalid.invalid/sdi/webhook',
      authHeader: null,
    })

    assert.deepEqual(openapi.configurations, [
      {
        fiscal_id: '00000000000',
        callbacks: [
          notification,
          { event: 'supplier-invoice', url: 'https://invalid.invalid/sdi/webhook' },
        ],
      },
    ])
  })

  test('a list longer than the page limit fails rather than answer in part', async ({ assert }) => {
    const page = recorded('receivedPage1')
    const openapi = new FakeOpenapi().on('GET', '/invoices', () => ({
      status: 200,
      body: { ...page.body, hasMore: true },
    }))

    const error = await openapi
      .gateway()
      .findSent({ number: '92/2026', issuedOn: '2026-10-29' })
      .catch((caught) => caught)

    assert.instanceOf(error, SdiFailure)
    assert.equal(error.code, 'tooManyPages')
    assert.lengthOf(openapi.requests, 50)
  })
})
