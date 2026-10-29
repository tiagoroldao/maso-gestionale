import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import User from '#models/user'
import InstanceSettings from '#models/instance_settings'
import SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoices from '#services/supplier_invoices'
import SupplierInvoiceArchiving from '#services/supplier_invoice_archiving'
import LegalStorage from '#services/legal_storage'
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
/** `completeCompany`'s VAT number, Openapi's fiscal id */
const FISCAL_ID = '01987654322'

/** The intermediary's account archives, or not, as the poller would read it */
async function accountArchives(gateway: FakeSdiGateway, on: boolean) {
  gateway.legalStorage = on
  await LegalStorage.refresh(gateway)
}

/** The account setting as last read, without asking the intermediary */
async function storedLegalStorage(on: boolean | null) {
  await db.rawQuery('INSERT INTO instance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING')
  await db
    .from('instance_settings')
    .where('id', 1)
    .update({ sdi_legal_storage: on, sdi_legal_storage_read_at: on === null ? null : new Date() })
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

/** Office uploads an XML file, through the intake */
async function uploaded(changes: { number?: string } = {}, contents?: Buffer) {
  const user = (await User.findBy('role', 'office')) ?? (await createUser('office'))
  return SupplierInvoices.receive(
    {
      contents: contents ?? Buffer.from(supplierInvoiceXml(changes), 'utf8'),
      name: 'fattura.xml',
    },
    { via: 'upload', user }
  )
}

/** Office uploads a file through the page (the signed fixture unless another is given) */
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
    SdiConnection.use(gateway)
    await completeCompany()
    return async () => {
      SdiConnection.restore()
      await rm(storagePath(), { recursive: true, force: true })
    }
  })

  test('one received through the intermediary was archived by it on receipt: nothing is sent', async ({
    client,
    assert,
  }) => {
    await accountArchives(gateway, true)

    const [invoice] = await receiveFromSdi()
    await invoice.refresh()

    assert.lengthOf(gateway.archived, 0)
    assert.equal(invoice.legalArchiving, 'automatic')
    assert.isNotNull(invoice.legalArchivingAt)
    assert.isNull(invoice.legalArchivingIds)
    assert.isNull(invoice.legalArchivingFailure)

    const office = await createUser('office')
    const page = await client.get(`/supplier-invoices/${invoice.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: {
        archivingOffered: true,
        archivingRetryable: false,
        legalArchiving: { state: 'automatic', ids: [], failure: null },
      },
    })

    // Never sent, by Office or the poller
    const again = await retry(client, office, invoice.id, { sdiId: SDI_ID })
    again.assertFlashMessage('error', it('flash.supplierInvoiceArchivingRefused.notWaiting'))
    assert.deepInclude(await SdiPolling.poll(), { archived: 0 })
    assert.lengthOf(gateway.archived, 0)

    // With the account not archiving, nothing is recorded
    await accountArchives(gateway, false)
    const [plain] = await receiveFromSdi({ number: 'FV-2026/2' }, '1084646898321')
    assert.isNull(plain.legalArchiving)
    assert.isNull(plain.legalArchivingAt)
  })

  test("Office's upload has no SDI identifier: marked failed until Office gives it, then sent as XML", async ({
    client,
    assert,
  }) => {
    await accountArchives(gateway, true)
    const office = await createUser('office')

    const response = await upload(client, office)
    response.assertFlashMessage('success', it('flash.supplierInvoiceUploaded', { count: 1 }))
    const invoice = await SupplierInvoice.firstOrFail()
    assert.equal(invoice.legalArchiving, 'failed')
    assert.equal(invoice.legalArchivingFailure, 'noSdiIdentifier')
    assert.lengthOf(gateway.archived, 0)
    const page = await client.get(`/supplier-invoices/${invoice.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: {
        sdiIdentifier: null,
        archivingRetryable: true,
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

    const sent = await retry(client, office, invoice.id, { sdiId: SDI_ID })
    sent.assertFlashMessage('success', it('flash.supplierInvoiceArchived'))
    await invoice.refresh()
    assert.equal(invoice.sdiIdentifier, SDI_ID)
    assert.equal(invoice.legalArchiving, 'requested')
    assert.deepEqual(invoice.legalArchivingIds, ['fake-archive-1'])
    // The .p7m goes as the XML it carries, under the name it came with
    const file = gateway.archived[0]
    assert.deepInclude(file, { sdiId: SDI_ID, fileName: 'supplier_invoice.xml.p7m' })
    assert.deepEqual(file.xml, extractXmlBytes(readFileSync(SUPPLIER_INVOICE_P7M)))
    assert.match(file.xml.toString('utf8'), /^<\?xml/)

    // Requested already: not sent again
    const again = await retry(client, office, invoice.id, { sdiId: SDI_ID })
    again.assertFlashMessage('error', it('flash.supplierInvoiceArchivingRefused.notWaiting'))
    assert.lengthOf(gateway.archived, 1)
  })

  test('with the account not archiving, or no intermediary, nothing is sent or queued', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')

    // The account doesn't archive
    await accountArchives(gateway, false)
    const [off] = await uploaded()
    assert.isNull(off.legalArchiving)
    assert.isNull(off.legalArchivingAt)
    const page = await client.get(`/supplier-invoices/${off.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      invoice: { archivingOffered: false, archivingRetryable: false, legalArchiving: null },
    })
    const refused = await retry(client, office, off.id, { sdiId: SDI_ID })
    refused.assertFlashMessage('error', it('flash.supplierInvoiceArchivingRefused.notOffered'))
    assert.deepInclude(await SdiPolling.poll(), { archived: 0 })

    // No intermediary, whatever was read before
    await storedLegalStorage(true)
    SdiConnection.use(new ManualSdiGateway())
    const [manual] = await uploaded({ number: 'FV-2026/2' })
    assert.isNull(manual.legalArchiving)
    const queue = await SupplierInvoiceArchiving.queueExisting().catch((error) => error.reason)
    assert.equal(queue, 'notOffered')
    assert.lengthOf(gateway.archived, 0)
  })

  test('Office sends a failed upload at once from its page', async ({ client, assert }) => {
    await accountArchives(gateway, true)
    const [invoice] = await uploaded()
    const office = await createUser('office')

    gateway.failNextArchive = new Error('Openapi 500: unavailable')
    const failed = await retry(client, office, invoice.id, { sdiId: SDI_ID })
    failed.assertFlashMessage(
      'error',
      it('flash.supplierInvoiceArchivingFailed', { detail: 'Openapi 500: unavailable' })
    )
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'failed')

    const admin = await createUser('admin')
    const response = await retry(client, admin, invoice.id, { sdiId: SDI_ID })
    response.assertFlashMessage('success', it('flash.supplierInvoiceArchived'))
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'requested')
    assert.lengthOf(gateway.archived, 1)
  })

  test('an uploaded file holding several invoices is sent once, and each records it', async ({
    assert,
  }) => {
    await accountArchives(gateway, true)
    const xml = supplierInvoiceXml()
    const body = /<FatturaElettronicaBody>[\s\S]*<\/FatturaElettronicaBody>/.exec(xml)![0]
    const batch = xml.replace(body, `${body}\n${body.replace('FV-2026/1234', 'FV-2026/1235')}`)

    const invoices = await uploaded({}, Buffer.from(batch))
    await SupplierInvoiceArchiving.retry(invoices[0], SDI_ID)

    assert.lengthOf(invoices, 2)
    assert.lengthOf(gateway.archived, 1)
    for (const invoice of invoices) await invoice.refresh()
    assert.deepEqual(
      invoices.map((invoice) => [invoice.legalArchiving, invoice.legalArchivingIds]),
      [
        ['requested', ['fake-archive-1']],
        ['requested', ['fake-archive-1']],
      ]
    )
  })

  test('a send cut off past the grace period is marked failed and retried by the poller; a recent one is left', async ({
    assert,
  }) => {
    const [stale] = await uploaded()
    const [recent] = await uploaded({ number: 'FV-2026/2' })
    await accountArchives(gateway, true)
    // Uploads whose identifier is known, cut off while sending
    const sending = (minutesAgo: number) => ({
      sdiIdentifier: SDI_ID,
      legalArchiving: 'sending' as const,
      legalArchivingAt: DateTime.now().minus({ minutes: minutesAgo }),
    })
    stale.merge(sending(30))
    await stale.save()
    recent.merge({ ...sending(1), sdiIdentifier: '1084646898321' })
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

  test('the one-off action queues the uploads never sent, not those received through the intermediary', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await accountArchives(gateway, false)
    const [first] = await uploaded()
    const [second] = await uploaded({ number: 'FV-2026/2' })
    const [received] = await receiveFromSdi({ number: 'FV-2026/3' }, '1084646898322')

    // Not archiving: refused, nothing queued
    const off = await client
      .post('/instance/archive-supplier-invoices')
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    off.assertFlashMessage('error', it('flash.supplierInvoiceArchivingRefused.notOffered'))
    await first.refresh()
    assert.isNull(first.legalArchiving)

    // Archiving: the two uploads wait for the action
    await accountArchives(gateway, true)
    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({
      settings: { legalStorage: 'active', receivedNotArchived: 2 },
    })

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
    await received.refresh()
    assert.isNull(received.legalArchiving)
    // An earlier poll is asked for; it sends them, and with no SDI
    // identifier they wait for Office
    const settings = await InstanceSettings.current()
    assert.isNotNull(settings.sdiPollRequestedAt)
    const report = await SdiPolling.poll()
    assert.deepInclude(report, { archived: 0 })
    assert.deepInclude(report.polled && report.failures, {
      step: 'archive',
      subject: 'fattura.xml',
      detail: 'noSdiIdentifier',
    })
    await first.refresh()
    assert.equal(first.legalArchiving, 'failed')

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
    const [invoice] = await uploaded()
    await accountArchives(gateway, true)

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
    assert.isNull(invoice.sdiIdentifier)
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

  /** Openapi, its account archiving, as read */
  async function archivingOpenapi(openapi: FakeOpenapi) {
    const gateway = openapi.registers(FISCAL_ID, true).gateway()
    SdiConnection.use(gateway)
    await LegalStorage.refresh(gateway)
    return gateway
  }

  test('an upload goes to POST /supplier_invoice_imports_legal_storage, with its uuids recorded', async ({
    assert,
  }) => {
    const openapi = new FakeOpenapi().on('POST', '/supplier_invoice_imports_legal_storage', {
      status: 201,
      body: { uuid: UUIDS },
    })
    await archivingOpenapi(openapi)

    const [invoice] = await uploaded()
    await SupplierInvoiceArchiving.retry(invoice, SDI_ID)
    await invoice.refresh()

    const posts = openapi.requests.filter((request) => request.method === 'POST')
    assert.lengthOf(posts, 1)
    assert.equal(posts[0].path, '/supplier_invoice_imports_legal_storage')
    assert.equal(posts[0].headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(posts[0].body!), {
      invoice: Buffer.from(supplierInvoiceXml(), 'utf8').toString('base64'),
      invoice_file_name: 'fattura.xml',
      sdi_id: SDI_ID,
    })
    assert.equal(invoice.legalArchiving, 'requested')
    assert.deepEqual(invoice.legalArchivingIds, UUIDS)

    // One received through Openapi is never imported
    const [received] = await receiveFromSdi({ number: 'FV-2026/2' }, '1084646898321')
    assert.equal(received.legalArchiving, 'automatic')
    assert.lengthOf(
      openapi.requests.filter((request) => request.method === 'POST'),
      1
    )
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
    await archivingOpenapi(openapi)
    const send = async (number: string, sdiId: string) => {
      const [invoice] = await uploaded({ number })
      await SupplierInvoiceArchiving.retry(invoice, sdiId)
      await invoice.refresh()
      return invoice
    }

    const wrapped = await send('FV-2026/1', SDI_ID)
    const refused = await send('FV-2026/2', '1084646898321')
    const noId = await send('FV-2026/3', '1084646898322')

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
    const before = {
      sdi_legal_storage: settings.sdiLegalStorage ?? null,
      sdi_legal_storage_read_at: settings.sdiLegalStorageReadAt?.toJSDate() ?? null,
    }
    cleanup(async () => {
      await db.from('instance_settings').where('id', 1).update(before)
      await rm(storagePath(), { recursive: true, force: true })
    })
    await completeCompany()
    const gateway = new FakeSdiGateway()
    await accountArchives(gateway, true)
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

    const [invoice] = await uploaded()
    await SupplierInvoiceArchiving.retry(invoice, SDI_ID)
    await invoice.refresh()

    assert.isFalse(lockedDuringSend)
    assert.equal(invoice.legalArchiving, 'requested')
  }).tags(['@committed'])
})
