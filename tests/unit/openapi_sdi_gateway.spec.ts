import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { OpenapiError } from '#services/openapi_sdi_gateway'
import { SdiSendRefusedError } from '#services/sdi_gateway'
import { FakeOpenapi } from '#tests/helpers/openapi'

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
    const openapi = new FakeOpenapi().on('GET', '/invoices', (request) =>
      request.query.get('page') === '1' ? 'receivedPage1' : 'emptyPage'
    )
    const since = DateTime.fromISO('2026-10-01T00:00:00Z')

    const refs = await openapi.gateway().received(since)

    assert.deepEqual(
      refs.map((ref) => [ref.remoteId, ref.fileName, ref.sdiId]),
      [
        ['9b8dddbd-7900-48c6-b159-0f60cc9b413c', 'IT12345678901_00001.xml', '1084646898320'],
        ['ffe8cdad-1a02-49fe-8cc6-f6b189eb6e5d', 'IT12345678901_00002.xml.p7m', '335228642533'],
      ]
    )
    assert.lengthOf(openapi.requests, 2)
    assert.equal(openapi.requests[0].query.get('type'), '1')
    assert.equal(openapi.requests[0].query.get('createdAt[after]'), '2026-10-01T00:00:00.000Z')
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

  test('finds the files sent for an Invoice by number and date', async ({ assert }) => {
    const openapi = new FakeOpenapi().on('GET', '/invoices', (request) =>
      request.query.get('page') === '1' ? 'receivedPage1' : 'emptyPage'
    )

    const found = await openapi.gateway().findSent({ number: '12/2026', issuedOn: '2026-10-29' })

    assert.lengthOf(found, 2)
    const query = openapi.requests[0].query
    assert.equal(query.get('type'), '0')
    assert.equal(query.get('invoiceNumber'), '12/2026')
    assert.equal(query.get('invoiceDate[after]'), '2026-10-29')
    assert.equal(query.get('invoiceDate[before]'), '2026-10-29')
  })
})
