import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import InstanceSettings from '#models/instance_settings'
import InvoiceSubmission from '#models/invoice_submission'
import SdiReceivedFile from '#models/sdi_received_file'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'
import SdiConnection, { gatewayFor } from '#services/sdi_connection'
import SdiPolling, { isPollDue } from '#services/sdi_polling'
import { OpenapiSdiGateway } from '#services/openapi_sdi_gateway'
import {
  supplierInvoiceIntake,
  supplierInvoicesIntake,
  type IncomingSupplierInvoice,
} from '#services/supplier_invoice_intake'
import SupplierInvoice from '#models/supplier_invoice'
import { FIXTURE, supplierInvoiceXml } from '#tests/helpers/supplier_invoices'
import { FakeOpenapi, sentListWith } from '#tests/helpers/openapi'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { it } from '#tests/helpers/i18n'

const UUID = 'cb1e9d7b-a7f5-49f4-8abb-9111467891fd'
const RECEIVED = ['9b8dddbd-7900-48c6-b159-0f60cc9b413c', 'ffe8cdad-1a02-49fe-8cc6-f6b189eb6e5d']

async function finalised() {
  const invoice = await Invoices.create(await createCustomer())
  const standard = await vatCode()
  await Invoices.save(invoice, {
    lines: [{ description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id }],
  })
  await Invoices.finalise(invoice)
  await invoice.refresh()
  return invoice
}

/** Notices in the recorded responses are dated October 2026: send before them */
async function sentEarlier(submission: InvoiceSubmission) {
  const earlier = DateTime.fromISO('2026-10-01T10:00:00', { zone: 'Europe/Rome' })
  await InvoiceSubmission.query()
    .where('id', submission.id)
    .update({ sendingAt: earlier.toSQL(), submittedAt: earlier.toSQL() })
}

/** Lists by type: sent files (type 0) and received ones (type 1), one page each */
function lists(sent: string | (() => ReturnType<typeof sentListWith>), received: string) {
  return (request: { query: URLSearchParams }) =>
    request.query.get('page') !== '1'
      ? 'emptyPage'
      : request.query.get('type') === '0'
        ? typeof sent === 'string'
          ? sent
          : sent()
        : received
}

const posts = (openapi: FakeOpenapi) =>
  openapi.requests.filter((request) => request.method === 'POST')

test.group('SDI through Openapi', (group) => {
  let openapi: FakeOpenapi
  group.each.setup(() => {
    openapi = new FakeOpenapi()
      .on('GET', '/invoices', lists('emptyPage', 'emptyPage'))
      .keepsApiConfigurations()
    SdiConnection.use(openapi.gateway())
    SdiPolling.registered = null
    // Received files wait unless a test hands them over
    supplierInvoiceIntake.current = null
    return () => {
      SdiConnection.restore()
      supplierInvoiceIntake.current = supplierInvoicesIntake
    }
  })

  test('Office sends a finalised Invoice; the poll records the delivery', async ({
    client,
    assert,
  }) => {
    openapi
      .on('POST', '/invoices', 'sent')
      .on('GET', `/invoices_notifications/${UUID}`, 'notificationsDelivered')
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()

    await client.post(`/invoices/${invoice.id}/submissions`).withCsrfToken().loginAs(office)
    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ openSubmission: { automatic: true, sending: false } })

    const response = await client
      .post(`/invoices/${invoice.id}/submissions/confirm`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.submissionSent'))

    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.equal(submission.channel, 'openapi')
    assert.equal(submission.remoteId, UUID)
    assert.equal(submission.submittedBy, office.id)
    // Submitted as of the moment the send began
    assert.equal(submission.submittedAt!.toMillis(), submission.sendingAt!.toMillis())
    assert.equal(posts(openapi)[0].body, submission.xml)
    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')

    await sentEarlier(submission)
    const report = await SdiPolling.poll()
    assert.deepInclude(report, { polled: true, outcomes: 1, failures: [] })
    await invoice.refresh()
    assert.equal(invoice.status, 'delivered')
    await submission.refresh()
    assert.equal(submission.outcome, 'delivered')
    assert.equal(submission.noticeOn!.toISODate(), '2026-10-30')
    assert.equal(submission.sdiId, '4242')
    assert.isNull(submission.outcomeBy)
    const settings = await InstanceSettings.findOrFail(1)
    assert.isNotNull(settings.sdiPolledAt)
    assert.isNull(settings.sdiPollFailure)
  })

  test("a polled Rejection reopens the Invoice with SDI's error codes", async ({ assert }) => {
    openapi
      .on('POST', '/invoices', 'sent')
      .on('GET', `/invoices_notifications/${UUID}`, 'notificationsRejected')
    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    await sentEarlier(submission)

    await SdiPolling.poll()

    await invoice.refresh()
    assert.equal(invoice.status, 'rejected')
    await submission.refresh()
    assert.equal(submission.outcomeNotes, '00100 Certificato di firma scaduto')
    assert.equal(submission.noticeOn!.toISODate(), '2026-10-30')

    // No answer yet for a later Submission: it keeps waiting
    openapi.on('GET', `/invoices_notifications/${UUID}`, 'notificationsNone')
    assert.deepInclude(await SdiPolling.poll(), { outcomes: 0 })
  })

  test('a file Openapi refuses is not sent and can be sent again', async ({ client, assert }) => {
    let calls = 0
    openapi.on('POST', '/invoices', () => (++calls === 1 ? 'malformed' : 'sent'))
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)

    const refused = await client
      .post(`/invoices/${invoice.id}/submissions/confirm`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    refused.assertFlashMessage(
      'error',
      it('flash.submissionSendRefused', { detail: 'Openapi 422: Parsing error: malformed XML' })
    )
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.isNull(submission.sendingAt)
    assert.isNull(submission.submittedAt)
    // Nothing went: no file kept as sent
    assert.isNull(submission.xml)
    assert.equal(submission.sendFailure, 'Openapi 422: Parsing error: malformed XML')
    await invoice.refresh()
    assert.equal(invoice.status, 'finalised')
    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      openSubmission: { sending: false, sendFailure: 'Openapi 422: Parsing error: malformed XML' },
    })

    const again = await client
      .post(`/invoices/${invoice.id}/submissions/confirm`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertFlashMessage('success', it('flash.submissionSent'))
    await submission.refresh()
    assert.equal(submission.remoteId, UUID)
    assert.isNull(submission.sendFailure)
    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')
  })

  test('a send with an unknown result stays "sending" until the poll finds it', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()
    // The recorded sandbox list, holding this Invoice's number
    openapi
      .on('POST', '/invoices', 'unavailable')
      .on(
        'GET',
        '/invoices',
        lists(() => sentListWith(invoice.formattedNumber!), 'emptyPage')
      )
      .on('GET', `/invoices_notifications/${UUID}`, 'notificationsNone')
    await Submissions.prepare(invoice)

    const uncertain = await client
      .post(`/invoices/${invoice.id}/submissions/confirm`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    uncertain.assertFlashMessage(
      'error',
      it('flash.submissionSendUncertain', {
        detail: 'Openapi 500: service temporarily unavailable',
      })
    )
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.isNotNull(submission.sendingAt)
    assert.isNull(submission.submittedAt)

    // Not sent twice
    const twice = await client
      .post(`/invoices/${invoice.id}/submissions/confirm`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    twice.assertFlashMessage('error', it('flash.submissionSending'))
    assert.lengthOf(posts(openapi), 1)

    // Within the grace period the poll leaves it alone
    assert.deepInclude(await SdiPolling.poll(), { settled: 0 })
    const sendingAt = DateTime.now().minus({ minutes: 15 })
    await InvoiceSubmission.query()
      .where('id', submission.id)
      .update({ sendingAt: sendingAt.toSQL() })

    assert.deepInclude(await SdiPolling.poll(), { settled: 1 })
    await submission.refresh()
    assert.equal(submission.remoteId, UUID)
    assert.equal(submission.submittedAt!.toMillis(), submission.sendingAt!.toMillis())
    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')
    const lookup = openapi.requests.find((request) => request.query.get('type') === '0')!
    assert.equal(lookup.query.get('invoiceDate[after]'), invoice.issuedOn!.toISODate())
  })

  test('a send never found at Openapi is ready to send again', async ({ client, assert }) => {
    openapi.on('POST', '/invoices', new TypeError('fetch failed'))
    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto').catch(() => null)
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    await InvoiceSubmission.query()
      .where('id', submission.id)
      .update({ sendingAt: DateTime.now().minus({ minutes: 15 }).toSQL() })

    assert.deepInclude(await SdiPolling.poll(), { settled: 1 })

    await submission.refresh()
    assert.isNull(submission.sendingAt)
    assert.isNull(submission.xml)
    assert.equal(submission.sendFailure, 'notFoundAtIntermediary')
    await invoice.refresh()
    assert.equal(invoice.status, 'finalised')
    // Office reads why in Italian
    const page = await client
      .get(`/invoices/${invoice.id}/edit`)
      .withInertia()
      .loginAs(await createUser('office'))
    page.assertInertiaPropsContains({
      openSubmission: { sending: false, sendFailure: it('ui.sdiFailures.notFoundAtIntermediary') },
    })
  })

  test('the poll fetches received Supplier Invoices once and keeps them for the intake', async ({
    client,
    assert,
  }) => {
    await completeCompany()
    openapi.on('GET', '/invoices', lists('emptyPage', 'receivedPage1'))
    for (const id of RECEIVED) openapi.on('GET', `/invoices_download/${id}`, 'supplierInvoiceXml')
    const downloads = () =>
      openapi.requests.filter((request) => request.path.startsWith('/invoices_download/'))

    assert.deepInclude(await SdiPolling.poll(), { received: 2, handed: 0 })
    const files = await SdiReceivedFile.query().orderBy('receivedAt')
    assert.deepEqual(
      files.map((file) => [file.remoteId, file.fileName, file.sdiId, file.handedAt]),
      [
        [RECEIVED[0], 'IT12345678901_00001.xml', '1084646898320', null],
        [RECEIVED[1], 'IT12345678901_00002.xml.p7m', '335228642533', null],
      ]
    )
    assert.include(files[0].content.toString('utf8'), '<Numero>1</Numero>')
    // Listed again from a day before the newest one, but not downloaded again
    assert.deepInclude(await SdiPolling.poll(), { received: 0 })
    assert.lengthOf(downloads(), 2)
    const since = openapi.requests.findLast((request) => request.query.get('type') === '1')!
    assert.equal(since.query.get('createdAt[after]'), '2026-10-28T08:32:19.000Z')

    const page = await client
      .get('/instance')
      .withInertia()
      .loginAs(await createUser('superuser'))
    page.assertInertiaPropsContains({ settings: { receivedWaiting: 2 } })

    // Once the intake exists (#198) it takes them; one it refuses waits
    const taken: IncomingSupplierInvoice[] = []
    let refusals = 0
    supplierInvoiceIntake.current = {
      async receive(file) {
        if (file.fileName.endsWith('.p7m') && refusals++ === 0) {
          throw new Error('signature unread')
        }
        taken.push(file)
      },
    }
    const report = await SdiPolling.poll()
    assert.deepInclude(report, { handed: 1 })
    assert.deepEqual(report.polled && report.failures, [
      { step: 'handOver', subject: 'IT12345678901_00002.xml.p7m', detail: 'signature unread' },
    ])
    assert.deepInclude(await SdiPolling.poll(), { handed: 1 })
    assert.deepEqual(
      taken.map((file) => [file.fileName, file.sdiId]),
      [
        ['IT12345678901_00001.xml', '1084646898320'],
        ['IT12345678901_00002.xml.p7m', '335228642533'],
      ]
    )
    assert.lengthOf(await SdiReceivedFile.query().whereNull('handedAt'), 0)
  })

  test('received files land in the Supplier Invoice inbox, once', async ({ assert }) => {
    await completeCompany()
    supplierInvoiceIntake.current = supplierInvoicesIntake
    openapi.on('GET', '/invoices', lists('emptyPage', 'receivedPage1'))
    // Both files hold the same invoice: the second is a duplicate
    const xml = { status: 200, text: supplierInvoiceXml(), contentType: 'application/octet-stream' }
    for (const id of RECEIVED) openapi.on('GET', `/invoices_download/${id}`, xml)

    const report = await SdiPolling.poll()

    assert.deepInclude(report, { received: 2, handed: 2, failures: [] })
    const invoices = await SupplierInvoice.all()
    assert.lengthOf(invoices, 1)
    assert.equal(invoices[0].number, FIXTURE.number)
    assert.equal(invoices[0].receivedVia, 'sdi')
    assert.equal(invoices[0].sdiIdentifier, '1084646898320')
    assert.lengthOf(await SdiReceivedFile.query().whereNull('handedAt'), 0)
  })

  test('a failing poll is recorded for the Superuser and does not stop the rest', async ({
    client,
    assert,
  }) => {
    openapi
      .on('POST', '/invoices', 'sent')
      .on('GET', `/invoices_notifications/${UUID}`, 'wrongToken')
      .on('GET', '/invoices', lists('emptyPage', 'receivedPage1'))
    for (const id of RECEIVED) openapi.on('GET', `/invoices_download/${id}`, 'supplierInvoiceXml')
    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')

    const report = await SdiPolling.poll()

    assert.deepInclude(report, { outcomes: 0, received: 2 })
    const settings = await InstanceSettings.findOrFail(1)
    assert.include(settings.sdiPollFailure, 'Openapi 401: Wrong Token')
    const page = await client
      .get('/instance')
      .withInertia()
      .loginAs(await createUser('superuser'))
    const submission = await InvoiceSubmission.findByOrFail('invoiceId', invoice.id)
    assert.deepInclude(page.inertiaProps.settings.pollFailures, {
      step: 'outcome',
      subject: submission.fileName,
      detail: 'Openapi 401: Wrong Token',
    })
  })
})

test.group('SDI receiving callback', (group) => {
  const SECRET = 'whsec_4567890abcdef'
  let openapi: FakeOpenapi
  group.each.setup(() => {
    openapi = new FakeOpenapi()
      .on('GET', '/invoices', lists('emptyPage', 'emptyPage'))
      .keepsApiConfigurations({
        fiscal_id: '01987654322',
        callbacks: [{ event: 'customer-notification', url: 'https://elsewhere.example/hook' }],
      })
    SdiConnection.use(openapi.gateway())
    SdiPolling.registered = null
    return () => SdiConnection.restore()
  })

  const save = (client: any, superuser: any, fields: Record<string, string>) =>
    client
      .put('/instance')
      .form({ sdiEnvironment: 'sandbox', pollingMinutes: '30', ...fields })
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)

  test('saving Openapi mode registers the callback Openapi needs to receive', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await completeCompany()

    // Without the webhook: the placeholder, which never resolves
    const saved = await save(client, superuser, { sdiMode: 'openapi', openapiToken: 'oat_1' })
    saved.assertFlashMessage('success', it('flash.instanceSaved'))
    assert.deepEqual(openapi.configurations, [
      {
        fiscal_id: '01987654322',
        callbacks: [
          { event: 'customer-notification', url: 'https://elsewhere.example/hook' },
          { event: 'supplier-invoice', url: 'https://invalid.invalid/sdi/webhook' },
        ],
      },
    ])

    // Saved again unchanged: read, not written
    await save(client, superuser, { sdiMode: 'openapi' })
    assert.lengthOf(openapi.configurations, 1)
    assert.deepInclude(
      openapi.requests.map((request) => `${request.method} ${request.path}`),
      'GET /api_configurations'
    )

    // With the webhook: its URL, carrying its secret
    await save(client, superuser, {
      sdiMode: 'openapi',
      webhookEnabled: 'true',
      webhookSecret: SECRET,
      publicUrl: 'https://maso.example.it',
    })
    assert.lengthOf(openapi.configurations, 2)
    assert.deepEqual(openapi.configurations[1].callbacks[1], {
      event: 'supplier-invoice',
      url: 'https://maso.example.it/sdi/webhook',
      auth_header: `Bearer ${SECRET}`,
    })
    // Other events' callbacks are kept
    assert.equal(openapi.configurations[1].callbacks[0].event, 'customer-notification')
  })

  test('saving still works when the callback can not be registered', async ({ client, assert }) => {
    const superuser = await createUser('superuser')
    // No VAT number in Company settings yet: no fiscal id to register for
    const saved = await save(client, superuser, { sdiMode: 'openapi', openapiToken: 'oat_1' })
    saved.assertFlashMessage(
      'error',
      it('flash.receivingNotRegistered', { detail: it('ui.sdiFailures.noFiscalId') })
    )
    const settings = await InstanceSettings.findOrFail(1)
    assert.equal(settings.sdiMode, 'openapi')
    assert.lengthOf(openapi.configurations, 0)
  })

  test('the poller registers it on its first poll, and again only on a change', async ({
    assert,
  }) => {
    await completeCompany()

    await SdiPolling.poll()
    await SdiPolling.poll()
    assert.lengthOf(openapi.configurations, 1)
    assert.equal(
      openapi.requests.filter((request) => request.path === '/api_configurations').length,
      2
    )

    // The webhook turned on elsewhere: registered again
    const settings = await InstanceSettings.current()
    settings.merge({ webhookEnabled: true, publicUrl: 'https://maso.example.it' })
    settings.secret = SECRET
    await settings.save()
    await SdiPolling.poll()
    assert.lengthOf(openapi.configurations, 2)
    assert.equal(openapi.configurations[1].callbacks[1].url, 'https://maso.example.it/sdi/webhook')
  })

  test('a failed registration is a poll failure, and the rest of the poll goes on', async ({
    assert,
  }) => {
    await completeCompany()
    openapi.on('POST', '/api_configurations', 'wrongToken')

    const report = await SdiPolling.poll()

    assert.deepInclude(report.polled && report.failures, {
      step: 'register',
      subject: null,
      detail: 'Openapi 401: Wrong Token',
    })
    assert.isNull(SdiPolling.registered)
  })
})

test.group('SDI without a connection', () => {
  test('nothing is polled and Submissions stay manual', async ({ assert }) => {
    assert.deepEqual(await SdiPolling.poll(), { polled: false })
    assert.isNull(await InstanceSettings.find(1))

    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)
    assert.equal(await Submissions.confirm(invoice, 'Sconto'), 'uploaded')
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.equal(submission.channel, 'manual')
    assert.isNull(submission.sendingAt)
    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')
  })

  test('the settings choose the gateway; no usable token means manual', async ({ assert }) => {
    const settings = new InstanceSettings().merge({
      sdiMode: 'openapi',
      sdiEnvironment: 'production',
    })
    assert.equal(gatewayFor(settings).channel, 'manual')
    settings.token = 'oat_secret_123'
    const gateway = gatewayFor(settings)
    assert.instanceOf(gateway, OpenapiSdiGateway)
    assert.equal((gateway as OpenapiSdiGateway).baseUrl, 'https://sdi.openapi.it')

    // Stored under another APP_KEY: unreadable, so manual
    settings.openapiToken = 'not-decryptable-under-this-key'
    assert.isTrue(settings.tokenUnreadable)
    assert.equal(gatewayFor(settings).channel, 'manual')

    settings.token = 'oat_secret_123'
    settings.sdiMode = 'manual'
    assert.equal(gatewayFor(settings).channel, 'manual')
  })

  test('a Submission prepared by hand stays by hand once Openapi is on', async ({ assert }) => {
    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)
    const openapi = new FakeOpenapi().on('POST', '/invoices', 'sent')
    SdiConnection.use(openapi.gateway())
    try {
      // Office may already have uploaded its file on the portal
      assert.equal(await Submissions.confirm(invoice, 'Sconto'), 'uploaded')
    } finally {
      SdiConnection.restore()
    }
    assert.lengthOf(openapi.requests, 0)
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.equal(submission.channel, 'manual')
  })
})

test.group('SDI webhook', () => {
  const SECRET = 'whsec_4567890abcdef'

  async function enable(enabled = true) {
    const settings = await InstanceSettings.current()
    settings.merge({ webhookEnabled: enabled, publicUrl: 'https://maso.example.it' })
    settings.secret = SECRET
    await settings.save()
    return settings
  }

  test('only a call with the secret asks for an earlier poll', async ({ client, assert }) => {
    // Some user exists, so the first-run setup doesn't take the route
    await createUser('admin')
    const disabled = await enable(false)
    const off = await client.post('/sdi/webhook').header('authorization', `Bearer ${SECRET}`)
    off.assertStatus(404)

    await disabled.merge({ webhookEnabled: true }).save()
    for (const header of [null, 'Bearer wrong-secret-0000000', SECRET.slice(0, -1)]) {
      const request = client.post('/sdi/webhook')
      const refused = await (header ? request.header('authorization', header) : request)
      refused.assertStatus(401)
    }
    await disabled.refresh()
    assert.isNull(disabled.sdiPollRequestedAt)

    disabled.sdiPolledAt = DateTime.now().minus({ minutes: 1 })
    await disabled.save()
    assert.isFalse(isPollDue(disabled))
    for (const header of [`Bearer ${SECRET}`, SECRET]) {
      const accepted = await client.post('/sdi/webhook').header('authorization', header)
      accepted.assertStatus(204)
    }
    await disabled.refresh()
    assert.isNotNull(disabled.sdiPollRequestedAt)
    assert.isTrue(isPollDue(disabled))
  })

  test('a poll is due after the interval, or first of all', async ({ assert }) => {
    const settings = new InstanceSettings().merge({ pollingMinutes: 30 })
    const now = DateTime.now()
    assert.isTrue(isPollDue(settings, now))
    settings.sdiPolledAt = now.minus({ minutes: 29 })
    assert.isFalse(isPollDue(settings, now))
    settings.sdiPolledAt = now.minus({ minutes: 30 })
    assert.isTrue(isPollDue(settings, now))
  })
})

test.group('SDI send and the Invoice lock', () => {
  test('the file goes while the Invoice is not locked', async ({ assert, cleanup }) => {
    cleanup(await committedData())
    await completeCompany()
    const invoice = await finalised()
    let lockedDuringSend: boolean | null = null
    const openapi = new FakeOpenapi().on('POST', '/invoices', async () => {
      // Another connection: NOWAIT fails at once if the row is locked
      lockedDuringSend = await db
        .transaction((trx) =>
          trx.rawQuery('SELECT id FROM invoices WHERE id = ? FOR UPDATE NOWAIT', [invoice.id])
        )
        .then(() => false)
        .catch(() => true)
      return 'sent'
    })
    SdiConnection.use(openapi.gateway())
    cleanup(() => SdiConnection.restore())
    await Submissions.prepare(invoice)

    await Submissions.confirm(invoice, 'Sconto')

    assert.isFalse(lockedDuringSend)
    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')
  }).tags(['@committed'])
})
