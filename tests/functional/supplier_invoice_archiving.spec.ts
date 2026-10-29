import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'
import InstanceSettings from '#models/instance_settings'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoices from '#services/supplier_invoices'
import SupplierInvoiceArchiving from '#services/supplier_invoice_archiving'
import SdiConnection from '#services/sdi_connection'
import SdiPolling from '#services/sdi_polling'
import { FakeSdiGateway, ManualSdiGateway } from '#services/sdi_gateway'
import { storagePath } from '#services/storage'
import { extractXmlBytes } from '#fiscal/fattura_pa_reader'
import { FakeOpenapi, recorded } from '#tests/helpers/openapi'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import { SUPPLIER_INVOICE_P7M, supplierInvoiceXml } from '#tests/helpers/supplier_invoices'

const SDI_ID = '1084646898320'
const UUIDS = ['3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b', '7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d']

async function archivingSetting(on: boolean) {
  const settings = await InstanceSettings.current()
  settings.sdiLegalArchiving = on
  await settings.save()
}

/** A Supplier Invoice file received through the intermediary, as the poller hands it over */
function receiveFromSdi(changes: { number?: string } = {}, sdiIdentifier: string | null = SDI_ID) {
  return SupplierInvoices.receive(
    {
      contents: Buffer.from(supplierInvoiceXml(changes), 'utf8'),
      name: 'IT03456789019_00001.xml',
    },
    { via: 'sdi', sdiIdentifier }
  )
}

/** Office uploads a file (the signed fixture unless another is given) */
function upload(client: ApiClient, user: User, file: string = SUPPLIER_INVOICE_P7M) {
  return client
    .post('/supplier-invoices')
    .file('invoice', file)
    .header('referer', '/supplier-invoices')
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

/** Office sends the invoice to archiving from its page */
function retry(client: ApiClient, user: User, id: number, form: Record<string, string> = {}) {
  return client
    .post(`/supplier-invoices/${id}/legal-archiving`)
    .form(form)
    .header('referer', `/supplier-invoices/${id}`)
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

test.group('Legal archiving of Supplier Invoices', (group) => {
  let gateway: FakeSdiGateway
  group.each.setup(async () => {
    gateway = new FakeSdiGateway()
    gateway.receivedArchiving = true
    SdiConnection.use(gateway)
    await completeCompany()
    return async () => {
      SdiConnection.restore()
      await rm(storagePath(), { recursive: true, force: true })
    }
  })

  test('a Supplier Invoice received through the intermediary is sent once stored, and its page shows it', async ({
    client,
    assert,
  }) => {
    await archivingSetting(true)

    const [invoice] = await receiveFromSdi()

    assert.lengthOf(gateway.archived, 1)
    assert.deepInclude(gateway.archived[0], { fileName: 'IT03456789019_00001.xml', sdiId: SDI_ID })
    assert.equal(gateway.archived[0].xml.toString('utf8'), supplierInvoiceXml())
    assert.equal(invoice.legalArchiving, 'requested')
    assert.deepEqual(invoice.legalArchivingIds, ['fake-archive-1'])
    assert.isNull(invoice.legalArchivingFailure)
    assert.isNotNull(invoice.legalArchivingAt)

    const office = await createUser('office')
    const page = await client.get(`/supplier-invoices/${invoice.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: {
        archivingOffered: true,
        archivingRetryable: false,
        legalArchiving: { state: 'requested', ids: ['fake-archive-1'], failure: null },
      },
    })

    // Requested already: not sent again, by Office or the poller
    const again = await retry(client, office, invoice.id)
    again.assertFlashMessage('error', it('flash.supplierInvoiceArchivingRefused.notWaiting'))
    assert.deepInclude(await SdiPolling.poll(), { archived: 0 })
    assert.lengthOf(gateway.archived, 1)
  })

  test("Office's upload has no SDI identifier: marked failed until Office gives it, then sent as XML", async ({
    client,
    assert,
  }) => {
    await archivingSetting(true)
    const office = await createUser('office')

    const uploaded = await upload(client, office)
    uploaded.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))
    const invoice = await SupplierInvoice.firstOrFail()
    assert.equal(invoice.legalArchiving, 'failed')
    assert.equal(invoice.legalArchivingFailure, 'noSdiIdentifier')
    assert.lengthOf(gateway.archived, 0)
    const page = await client.get(`/supplier-invoices/${invoice.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: {
        sdiIdentifier: null,
        legalArchiving: { state: 'failed', failure: 'noSdiIdentifier', ids: [] },
      },
    })

    // The poller can't send it without the identifier
    assert.deepInclude(await SdiPolling.poll(), { archived: 0 })
    assert.lengthOf(gateway.archived, 0)

    // Without it, or a malformed one, it stays failed
    const missing = await retry(client, office, invoice.id)
    missing.assertFlashMessage(
      'error',
      it('flash.supplierInvoiceArchivingFailed', { detail: it('ui.sdiFailures.noSdiIdentifier') })
    )
    const malformed = await retry(client, office, invoice.id, { sdiId: '12AB' })
    assert.deepEqual(malformed.flashMessage('inputErrorsBag').sdiId, [
      it('validator.shared.messages.regex'),
    ])
    assert.lengthOf(gateway.archived, 0)

    // A wrong one the intermediary refuses isn't kept: Office types it again
    gateway.failNextArchive = new Error('Openapi 400: sdi_id not found')
    const wrong = await retry(client, office, invoice.id, { sdiId: '999999' })
    wrong.assertFlashMessage(
      'error',
      it('flash.supplierInvoiceArchivingFailed', { detail: 'Openapi 400: sdi_id not found' })
    )
    await invoice.refresh()
    assert.isNull(invoice.sdiIdentifier)
    assert.equal(invoice.legalArchiving, 'failed')
    const corrected = await client
      .get(`/supplier-invoices/${invoice.id}`)
      .withInertia()
      .loginAs(office)
    corrected.assertInertiaPropsContains({
      invoice: {
        sdiIdentifier: null,
        archivingRetryable: true,
        legalArchiving: { state: 'failed', failure: 'Openapi 400: sdi_id not found' },
      },
    })
    // The poller can't use it either
    assert.deepInclude(await SdiPolling.poll(), { archived: 0 })

    const response = await retry(client, office, invoice.id, { sdiId: SDI_ID })
    response.assertFlashMessage('success', it('flash.supplierInvoiceArchived'))
    await invoice.refresh()
    assert.equal(invoice.sdiIdentifier, SDI_ID)
    assert.equal(invoice.legalArchiving, 'requested')
    assert.deepEqual(invoice.legalArchivingIds, ['fake-archive-1'])
    // The .p7m goes as the XML it carries, under the name it came with
    const sent = gateway.archived[0]
    assert.deepInclude(sent, { sdiId: SDI_ID, fileName: 'supplier_invoice.xml.p7m' })
    assert.deepEqual(sent.xml, extractXmlBytes(readFileSync(SUPPLIER_INVOICE_P7M)))
    assert.match(sent.xml.toString('utf8'), /^<\?xml/)
  })

  test('with the setting off, or an intermediary that cannot, nothing is sent or queued', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')

    // Off
    await archivingSetting(false)
    const [off] = await receiveFromSdi()
    // On, with an intermediary that can't archive received invoices
    await archivingSetting(true)
    gateway.receivedArchiving = false
    const [cannot] = await receiveFromSdi({ number: 'FV-2026/2' }, '1084646898321')

    assert.lengthOf(gateway.archived, 0)
    for (const invoice of [off, cannot]) {
      assert.isNull(invoice.legalArchiving)
      assert.isNull(invoice.legalArchivingAt)
    }
    const page = await client.get(`/supplier-invoices/${off.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: { archivingOffered: false, archivingRetryable: false, legalArchiving: null },
    })
    const refused = await retry(client, office, off.id)
    refused.assertFlashMessage('error', it('flash.supplierInvoiceArchivingRefused.notOffered'))
    assert.deepInclude(await SdiPolling.poll(), { archived: 0 })
    assert.lengthOf(gateway.archived, 0)

    // The manual mode can't either
    assert.isFalse(new ManualSdiGateway().receivedArchiving)
    assert.isFalse(new FakeSdiGateway().receivedArchiving)
  })

  test('a failed send never refuses the invoice; the poller retries and shows the failure', async ({
    client,
    assert,
  }) => {
    await archivingSetting(true)
    gateway.failNextArchive = new Error('Openapi 402: credit')

    const [invoice] = await receiveFromSdi()

    // Stored all the same
    assert.equal(invoice.status, 'to_handle')
    assert.equal(invoice.legalArchiving, 'failed')
    assert.equal(invoice.legalArchivingFailure, 'Openapi 402: credit')
    assert.isNull(invoice.legalArchivingIds)
    const office = await createUser('office')
    const page = await client.get(`/supplier-invoices/${invoice.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: { legalArchiving: { state: 'failed', failure: 'Openapi 402: credit' } },
    })

    // It fails again: a poll failure for the Superuser
    gateway.failNextArchive = new Error('Openapi 402: credit')
    const failed = await SdiPolling.poll()
    assert.deepInclude(failed, { archived: 0 })
    assert.deepInclude(failed.polled && failed.failures, {
      step: 'archive',
      subject: 'IT03456789019_00001.xml',
      detail: 'Openapi 402: credit',
    })
    const superuser = await createUser('superuser')
    const instance = await client.get('/instance').withInertia().loginAs(superuser)
    instance.assertInertiaPropsContains({
      settings: {
        pollFailures: [
          { step: 'archive', subject: 'IT03456789019_00001.xml', detail: 'Openapi 402: credit' },
        ],
      },
    })

    // The next poll sends it
    assert.deepInclude(await SdiPolling.poll(), { archived: 1, failures: [] })
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'requested')
    assert.isNull(invoice.legalArchivingFailure)
    assert.lengthOf(gateway.archived, 1)
  })

  test('Office sends a failed one at once from its page', async ({ client, assert }) => {
    await archivingSetting(true)
    gateway.failNextArchive = new Error('Openapi 500: unavailable')
    const [invoice] = await receiveFromSdi()
    const office = await createUser('office')

    gateway.failNextArchive = new Error('Openapi 500: unavailable')
    const failed = await retry(client, office, invoice.id)
    failed.assertFlashMessage(
      'error',
      it('flash.supplierInvoiceArchivingFailed', { detail: 'Openapi 500: unavailable' })
    )
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'failed')

    const admin = await createUser('admin')
    const response = await retry(client, admin, invoice.id)
    response.assertFlashMessage('success', it('flash.supplierInvoiceArchived'))
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'requested')
    assert.lengthOf(gateway.archived, 1)
  })

  test('a file holding several invoices is sent once, and each records it', async ({ assert }) => {
    await archivingSetting(true)
    const xml = supplierInvoiceXml()
    const body = /<FatturaElettronicaBody>[\s\S]*<\/FatturaElettronicaBody>/.exec(xml)![0]
    const batch = xml.replace(body, `${body}\n${body.replace('FV-2026/1234', 'FV-2026/1235')}`)

    const invoices = await SupplierInvoices.receive(
      { contents: Buffer.from(batch), name: 'lotto.xml' },
      { via: 'sdi', sdiIdentifier: SDI_ID }
    )

    assert.lengthOf(invoices, 2)
    assert.lengthOf(gateway.archived, 1)
    assert.deepEqual(
      invoices.map((invoice) => [invoice.legalArchiving, invoice.legalArchivingIds]),
      [
        ['requested', ['fake-archive-1']],
        ['requested', ['fake-archive-1']],
      ]
    )
  })

  test('a send cut off past the grace period is retried by the poller; a recent one is left', async ({
    assert,
  }) => {
    await archivingSetting(false)
    const [stale] = await receiveFromSdi()
    const [recent] = await receiveFromSdi({ number: 'FV-2026/2' }, '1084646898321')
    await archivingSetting(true)
    const sending = (minutesAgo: number) => ({
      legalArchiving: 'sending' as const,
      legalArchivingAt: DateTime.now().minus({ minutes: minutesAgo }),
    })
    stale.merge(sending(30))
    await stale.save()
    recent.merge(sending(1))
    await recent.save()

    assert.deepInclude(await SdiPolling.poll(), { archived: 1 })

    await stale.refresh()
    await recent.refresh()
    assert.equal(stale.legalArchiving, 'requested')
    assert.equal(recent.legalArchiving, 'sending')
    assert.deepEqual(
      gateway.archived.map((file) => file.sdiId),
      [SDI_ID]
    )
  })

  test('the one-off action queues the invoices stored before the setting was on', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await archivingSetting(false)
    const [first] = await receiveFromSdi()
    const [second] = await receiveFromSdi({ number: 'FV-2026/2' }, '1084646898321')

    // Off: refused, nothing queued, and the page doesn't offer it
    const off = await client
      .post('/instance/archive-supplier-invoices')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    off.assertFlashMessage('error', it('flash.supplierInvoiceArchivingRefused.notOffered'))
    await first.refresh()
    assert.isNull(first.legalArchiving)

    // On: a new one goes at once; the two before wait for the action
    await archivingSetting(true)
    const [later] = await receiveFromSdi({ number: 'FV-2026/3' }, '1084646898322')
    assert.equal(later.legalArchiving, 'requested')
    assert.deepInclude(await SdiPolling.poll(), { archived: 0 })
    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({ settings: { legalArchiving: true, receivedNotArchived: 2 } })

    const response = await client
      .post('/instance/archive-supplier-invoices')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.supplierInvoicesQueued', { count: 2 }))
    for (const invoice of [first, second]) {
      await invoice.refresh()
      assert.equal(invoice.legalArchiving, 'queued')
    }
    // An earlier poll is asked for, and it sends them
    const settings = await InstanceSettings.current()
    assert.isNotNull(settings.sdiPollRequestedAt)
    assert.deepInclude(await SdiPolling.poll(), { archived: 2 })
    await first.refresh()
    await second.refresh()
    assert.equal(first.legalArchiving, 'requested')
    assert.equal(second.legalArchiving, 'requested')
    assert.lengthOf(gateway.archived, 3)

    // Nothing left to queue
    const again = await client
      .post('/instance/archive-supplier-invoices')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    again.assertFlashMessage('success', it('flash.supplierInvoicesQueued', { count: 0 }))
    const after = await client.get('/instance').withInertia().loginAs(superuser)
    after.assertInertiaPropsContains({ settings: { receivedNotArchived: 0 } })
  })

  test('the one-off action is for the Superuser only; sending again for Admin and Office only', async ({
    client,
    assert,
  }) => {
    await archivingSetting(false)
    const [invoice] = await receiveFromSdi()
    await archivingSetting(true)

    for (const role of ['admin', 'office', 'technician'] as const) {
      const user = await createUser(role)
      const response = await client
        .post('/instance/archive-supplier-invoices')
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    await invoice.refresh()
    assert.isNull(invoice.legalArchiving)

    // Failed, so that it could be sent again
    gateway.failNextArchive = new Error('Openapi 500')
    await SupplierInvoiceArchiving.queueExisting()
    await SdiPolling.poll()
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'failed')
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      const response = await retry(client, user, invoice.id, { sdiId: '999' })
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'failed')
    assert.equal(invoice.sdiIdentifier, SDI_ID)
    assert.lengthOf(gateway.archived, 0)
  })
})

test.group('Legal archiving of Supplier Invoices through Openapi', (group) => {
  group.each.setup(async () => {
    await completeCompany()
    return async () => {
      SdiConnection.restore()
      await rm(storagePath(), { recursive: true, force: true })
    }
  })

  test('the file goes to POST /supplier_invoice_imports_legal_storage, with its uuids recorded', async ({
    assert,
  }) => {
    const openapi = new FakeOpenapi().on('POST', '/supplier_invoice_imports_legal_storage', {
      status: 201,
      body: { uuid: UUIDS },
    })
    const gateway = openapi.gateway()
    assert.isTrue(gateway.receivedArchiving)
    SdiConnection.use(gateway)
    await archivingSetting(true)

    const [invoice] = await receiveFromSdi()

    const posts = openapi.requests.filter((request) => request.method === 'POST')
    assert.lengthOf(posts, 1)
    assert.equal(posts[0].path, '/supplier_invoice_imports_legal_storage')
    assert.equal(posts[0].headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(posts[0].body!), {
      invoice: Buffer.from(supplierInvoiceXml(), 'utf8').toString('base64'),
      invoice_file_name: 'IT03456789019_00001.xml',
      sdi_id: SDI_ID,
    })
    assert.equal(invoice.legalArchiving, 'requested')
    assert.deepEqual(invoice.legalArchivingIds, UUIDS)
  })

  test("Openapi's answer is read as { uuid } or { data: { uuid } }; a refusal is a failure", async ({
    assert,
  }) => {
    const answers = [
      { status: 201, body: { data: { uuid: UUIDS[0] }, success: true, message: '' } },
      recorded('noCredit'),
      { status: 201, body: { data: null, success: true } },
    ]
    const openapi = new FakeOpenapi().on('POST', '/supplier_invoice_imports_legal_storage', () =>
      answers.shift()!
    )
    SdiConnection.use(openapi.gateway())
    await archivingSetting(true)

    const [wrapped] = await receiveFromSdi()
    const [refused] = await receiveFromSdi({ number: 'FV-2026/2' }, '1084646898321')
    const [noId] = await receiveFromSdi({ number: 'FV-2026/3' }, '1084646898322')

    assert.deepEqual(wrapped.legalArchivingIds, [UUIDS[0]])
    assert.equal(refused.legalArchiving, 'failed')
    assert.equal(refused.legalArchivingFailure, `Openapi 402: ${recorded('noCredit').body.message}`)
    assert.equal(noId.legalArchiving, 'failed')
    assert.equal(noId.legalArchivingFailure, 'noRemoteId')
  })
})

test.group('Legal archiving of Supplier Invoices and locks', () => {
  test("the file goes while its invoices' rows are not locked", async ({ assert, cleanup }) => {
    cleanup(await committedData())
    const settings = await InstanceSettings.current()
    const before = settings.sdiLegalArchiving
    cleanup(async () => {
      await db.from('instance_settings').where('id', 1).update({ sdi_legal_archiving: before })
      await rm(storagePath(), { recursive: true, force: true })
    })
    await completeCompany()
    await archivingSetting(true)
    const gateway = new FakeSdiGateway()
    gateway.receivedArchiving = true
    let lockedDuringSend: boolean | null = null
    gateway.duringArchive = async () => {
      // Another connection: NOWAIT fails at once if a row is locked
      lockedDuringSend = await db
        .transaction((trx) =>
          trx.rawQuery(
            `SELECT id FROM supplier_invoices WHERE legal_archiving = 'sending' FOR UPDATE NOWAIT`
          )
        )
        .then((result) => (result.rows.length ? false : null))
        .catch(() => true)
    }
    SdiConnection.use(gateway)
    cleanup(() => SdiConnection.restore())

    const [invoice] = await receiveFromSdi()

    assert.isFalse(lockedDuringSend)
    assert.equal(invoice.legalArchiving, 'requested')
  }).tags(['@committed'])
})
