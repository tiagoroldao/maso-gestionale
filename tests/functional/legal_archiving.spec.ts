import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'
import InstanceSettings from '#models/instance_settings'
import InvoiceSubmission from '#models/invoice_submission'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'
import LegalStorage from '#services/legal_storage'
import SdiPolling from '#services/sdi_polling'
import { OpenapiError } from '#services/openapi_sdi_gateway'
import { FakeSdiGateway, ManualSdiGateway, SdiFailure } from '#services/sdi_gateway'
import SdiConnection from '#services/sdi_connection'
import { FakeOpenapi, recorded } from '#tests/helpers/openapi'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

const UUID = 'cb1e9d7b-a7f5-49f4-8abb-9111467891fd'
const OTHER_UUID = '0f6e8a52-3c1d-4b7e-9a2f-5d4c3b2a1908'
/** `completeCompany`'s VAT number, Openapi's fiscal id */
const FISCAL_ID = '01987654322'

/**
 * Openapi's refusal of a plain send for an account that archives
 * (sandbox, 2026-10-29, #224)
 */
const LEGAL_STORAGE_REQUIRED = {
  status: 412,
  body: {
    success: false,
    message:
      'Your current configuration for this fiscal_id does not allow requests on this endpoint. Please use: /invoices_legal_storage',
    data: null,
  },
}

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

/** Office prepares and sends the Invoice's Submission */
async function send(client: ApiClient, office: User, invoiceId: number) {
  await client.post(`/invoices/${invoiceId}/submissions`).withCsrfToken().loginAs(office)
  return client
    .post(`/invoices/${invoiceId}/submissions/confirm`)
    .withCsrfToken()
    .loginAs(office)
    .redirects(0)
}

test.group('Legal archiving: sending follows the account', (group) => {
  let gateway: FakeSdiGateway
  group.each.setup(async () => {
    gateway = new FakeSdiGateway()
    SdiConnection.use(gateway)
    await completeCompany()
    return () => SdiConnection.restore()
  })

  test('with the account archiving, the file is sent with archiving requested and the Submission records it', async ({
    client,
    assert,
  }) => {
    gateway.legalStorage = true
    await LegalStorage.refresh(gateway)
    const office = await createUser('office')
    const invoice = await finalised()

    const response = await send(client, office, invoice.id)
    response.assertFlashMessage('success', it('flash.submissionSent'))
    assert.deepEqual(
      gateway.submitted.map((file) => file.legalArchiving),
      [true]
    )
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.isTrue(submission.legalArchiving)
    assert.isNotNull(submission.submittedAt)

    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      submissions: [{ id: submission.id, legalArchiving: true }],
    })
  })

  test('with the account not archiving, or never read, the file goes plain without asking', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')

    // Never read
    const first = await finalised()
    await send(client, office, first.id)
    // Not archiving, as read
    await LegalStorage.refresh(gateway)
    const second = await finalised()
    await send(client, office, second.id)
    assert.lengthOf(gateway.legalStorageReads, 1)

    assert.deepEqual(
      gateway.submitted.map((file) => file.legalArchiving),
      [false, false]
    )
    const submissions = await InvoiceSubmission.query()
      .whereIn('invoiceId', [first.id, second.id])
      .orderBy('id')
    assert.deepEqual(
      submissions.map((submission) => [submission.legalArchiving, Boolean(submission.submittedAt)]),
      [
        [false, true],
        [false, true],
      ]
    )
    const page = await client.get(`/invoices/${second.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ submissions: [{ legalArchiving: false }] })
  })

  test('a send refused because the account changed reads it again, and the next send follows it', async ({
    client,
    assert,
  }) => {
    await LegalStorage.refresh(gateway)
    // The account archives since it was read: a plain send is refused
    gateway.legalStorage = true
    const office = await createUser('office')
    const invoice = await finalised()

    const refused = await send(client, office, invoice.id)
    refused.assertFlashMessage(
      'error',
      it('flash.submissionSendRefused', { detail: 'Archiving is required here' })
    )
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.isFalse(submission.legalArchiving)
    assert.isNull(submission.submittedAt)
    const settings = await InstanceSettings.current()
    assert.isTrue(settings.sdiLegalStorage)

    await send(client, office, invoice.id)
    await submission.refresh()
    assert.isTrue(submission.legalArchiving)
    assert.isNotNull(submission.submittedAt)
    assert.deepEqual(
      gateway.submitted.map((file) => file.legalArchiving),
      [true]
    )
  })

  test('an uncertain send keeps archiving when settled as sent, and drops it when not found', async ({
    client,
    assert,
  }) => {
    gateway.legalStorage = true
    await LegalStorage.refresh(gateway)
    const office = await createUser('office')
    const settled = async (arrived: boolean) => {
      const invoice = await finalised()
      gateway.failNext = new Error('timeout')
      await send(client, office, invoice.id)
      const submission = await InvoiceSubmission.query()
        .where('invoiceId', invoice.id)
        .preload('invoice')
        .firstOrFail()
      // Sending, with archiving asked for, and the result unknown
      assert.isTrue(submission.legalArchiving)
      assert.isNull(submission.submittedAt)
      // The intermediary did get it (and archives it), or never did
      if (arrived)
        gateway.submitted.push({ fileName: submission.fileName, xml: '', legalArchiving: true })

      await Submissions.settle(gateway, submission)
      await submission.refresh()
      return [submission.legalArchiving, Boolean(submission.submittedAt)]
    }

    assert.deepEqual(await settled(true), [true, true])
    gateway.submitted.length = 0
    assert.deepEqual(await settled(false), [false, false])
  })

  test('without an intermediary nothing is archived, whatever was read before', async ({
    assert,
  }) => {
    gateway.legalStorage = true
    await LegalStorage.refresh(gateway)
    const manual = new ManualSdiGateway()

    assert.isFalse(await LegalStorage.active(manual))
    assert.isFalse(await manual.readLegalStorage())
    assert.isTrue(await LegalStorage.active(gateway))
  })
})

test.group('Legal archiving: the poller reads the account', (group) => {
  let gateway: FakeSdiGateway
  group.each.setup(async () => {
    gateway = new FakeSdiGateway()
    SdiConnection.use(gateway)
    await completeCompany()
    return () => SdiConnection.restore()
  })

  test('read when never read, then once a day; a failed read keeps the last one', async ({
    assert,
  }) => {
    gateway.legalStorage = true

    assert.deepInclude(await SdiPolling.poll(), { failures: [] })
    assert.deepEqual(gateway.legalStorageReads, [FISCAL_ID])
    const settings = await InstanceSettings.current()
    assert.isTrue(settings.sdiLegalStorage)

    // Read less than a day ago: not again
    await SdiPolling.poll()
    assert.lengthOf(gateway.legalStorageReads, 1)

    // More than a day ago: read again, and a failure keeps the last one
    const dayAgo = DateTime.now().minus({ hours: 25 }).toJSDate()
    await db.from('instance_settings').where('id', 1).update({ sdi_legal_storage_read_at: dayAgo })
    gateway.failNextRead = new Error('Openapi 500: unavailable')
    const failed = await SdiPolling.poll()
    assert.deepInclude(failed.polled && failed.failures, {
      step: 'legalStorage',
      subject: null,
      detail: 'Openapi 500: unavailable',
    })
    await settings.refresh()
    assert.isTrue(settings.sdiLegalStorage)

    // The next poll reads it, now off
    gateway.legalStorage = false
    assert.deepInclude(await SdiPolling.poll(), { failures: [] })
    assert.lengthOf(gateway.legalStorageReads, 3)
    await settings.refresh()
    assert.isFalse(settings.sdiLegalStorage)
  })

  test('without a fiscal id it is a poll failure, and stays unread', async ({ assert }) => {
    await completeCompany({ vatNumber: null, taxCode: null })

    const report = await SdiPolling.poll()

    assert.deepInclude(report.polled && report.failures, {
      step: 'legalStorage',
      subject: null,
      detail: 'noFiscalId',
    })
    assert.lengthOf(gateway.legalStorageReads, 0)
    const settings = await InstanceSettings.current()
    assert.isNull(settings.sdiLegalStorage)
  })
})

test.group('Legal archiving through Openapi', (group) => {
  group.each.setup(async () => {
    await completeCompany()
    return () => SdiConnection.restore()
  })

  test('the account setting is read from GET /business_registry_configurations/{fiscal_id}', async ({
    assert,
  }) => {
    let flag = true
    const openapi = new FakeOpenapi().registers(FISCAL_ID, () => flag)
    const gateway = openapi.gateway()

    assert.isTrue(await gateway.readLegalStorage(FISCAL_ID))
    flag = false
    assert.isFalse(await gateway.readLegalStorage(FISCAL_ID))
    assert.deepEqual(
      openapi.requests.map((request) => [request.method, request.path]),
      [
        ['GET', `/business_registry_configurations/${FISCAL_ID}`],
        ['GET', `/business_registry_configurations/${FISCAL_ID}`],
      ]
    )

    // A list of one is read too; an answer without the flag is a failure
    openapi.on('GET', `/business_registry_configurations/${FISCAL_ID}`, {
      status: 200,
      body: { data: [{ fiscal_id: FISCAL_ID, apply_legal_storage: true }] },
    })
    assert.isTrue(await gateway.readLegalStorage(FISCAL_ID))
    openapi.on('GET', `/business_registry_configurations/${FISCAL_ID}`, {
      status: 200,
      body: { data: { fiscal_id: FISCAL_ID } },
    })
    const unread = await gateway.readLegalStorage(FISCAL_ID).catch((error) => error)
    assert.instanceOf(unread, SdiFailure)
    assert.equal(unread.code, 'legalStorageUnread')
    // Not registered
    const missing = await gateway.readLegalStorage('00000000000').catch((error) => error)
    assert.instanceOf(missing, OpenapiError)
    assert.equal(missing.status, 404)
  })

  test('with it on, the file goes to POST /invoices_legal_storage; with it off, to POST /invoices', async ({
    client,
    assert,
  }) => {
    let flag = true
    const openapi = new FakeOpenapi()
      .registers(FISCAL_ID, () => flag)
      .on('POST', '/invoices', () => {
        const sent = recorded('sent')
        sent.body.data.uuid = OTHER_UUID
        return sent
      })
      .on('POST', '/invoices_legal_storage', 'sent')
    const gateway = openapi.gateway()
    SdiConnection.use(gateway)
    const office = await createUser('office')

    await LegalStorage.refresh(gateway)
    const archived = await finalised()
    const archivedSent = await send(client, office, archived.id)
    archivedSent.assertFlashMessage('success', it('flash.submissionSent'))
    flag = false
    await LegalStorage.refresh(gateway)
    const plain = await finalised()
    const plainSent = await send(client, office, plain.id)
    plainSent.assertFlashMessage('success', it('flash.submissionSent'))

    const posts = openapi.requests.filter((request) => request.method === 'POST')
    assert.deepEqual(
      posts.map((request) => [request.path, request.headers['content-type']]),
      [
        ['/invoices_legal_storage', 'application/xml'],
        ['/invoices', 'application/xml'],
      ]
    )
    const [submission] = await InvoiceSubmission.query().where('invoiceId', archived.id)
    assert.equal(posts[0].body, submission.xml)
    assert.equal(submission.remoteId, UUID)
    assert.isTrue(submission.legalArchiving)
    const [other] = await InvoiceSubmission.query().where('invoiceId', plain.id)
    assert.equal(other.remoteId, OTHER_UUID)
    assert.isFalse(other.legalArchiving)
    assert.isNotNull(other.submittedAt)
  })

  test("Openapi's refusal of the other endpoint leaves the file unsent, and the setting is read again", async ({
    client,
    assert,
  }) => {
    let flag = false
    const openapi = new FakeOpenapi()
      .registers(FISCAL_ID, () => flag)
      .on('POST', '/invoices', () => (flag ? LEGAL_STORAGE_REQUIRED : 'sent'))
      .on('POST', '/invoices_legal_storage', () => (flag ? 'sent' : 'legalStorageNotAllowed'))
    const gateway = openapi.gateway()
    SdiConnection.use(gateway)
    await LegalStorage.refresh(gateway)
    const office = await createUser('office')
    const invoice = await finalised()

    // The account was set up again with archiving, after it was read
    flag = true
    const refused = await send(client, office, invoice.id)
    refused.assertFlashMessage(
      'error',
      it('flash.submissionSendRefused', {
        detail: `Openapi 412: ${LEGAL_STORAGE_REQUIRED.body.message}`,
      })
    )
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.isNull(submission.submittedAt)

    await send(client, office, invoice.id)
    await submission.refresh()
    assert.isNotNull(submission.submittedAt)
    assert.isTrue(submission.legalArchiving)
    assert.deepEqual(
      openapi.requests.map((request) => `${request.method} ${request.path}`),
      [
        `GET /business_registry_configurations/${FISCAL_ID}`,
        'POST /invoices',
        `GET /business_registry_configurations/${FISCAL_ID}`,
        'POST /invoices_legal_storage',
      ]
    )
  })
})

test.group('Legal archiving: Instance page', (group) => {
  let flag: boolean | null
  let openapi: FakeOpenapi
  // Saving Openapi mode registers the receiving callback: never live here
  group.each.setup(() => {
    flag = true
    openapi = new FakeOpenapi().keepsApiConfigurations().registers(FISCAL_ID, () => flag!)
    SdiConnection.use(openapi.gateway())
    return () => SdiConnection.restore()
  })

  const openapiFields = {
    sdiMode: 'openapi',
    sdiEnvironment: 'sandbox',
    pollingMinutes: '30',
    openapiToken: 'oat_secret_123',
  }

  test('shows the account setting, read when Openapi mode is saved; there is no switch', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await completeCompany()

    const unread = await client.get('/instance').withInertia().loginAs(superuser)
    unread.assertInertiaPropsContains({
      settings: { legalStorage: 'unknown', legalStorageReadAt: null },
    })

    // A switch sent anyway changes nothing
    const response = await client
      .put('/instance')
      .form({ ...openapiFields, sdiLegalArchiving: 'false' })
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.instanceSaved'))
    const settings = await InstanceSettings.findOrFail(1)
    assert.isTrue(settings.sdiLegalStorage)
    const active = await client.get('/instance').withInertia().loginAs(superuser)
    active.assertInertiaPropsContains({
      settings: {
        legalStorage: 'active',
        legalStorageReadAt: settings.sdiLegalStorageReadAt!.toISO(),
      },
    })

    // Off at Openapi: saving again reads it
    flag = false
    await client
      .put('/instance')
      .form({ ...openapiFields, openapiToken: '' })
      .withCsrfToken()
      .loginAs(superuser)
    const inactive = await client.get('/instance').withInertia().loginAs(superuser)
    inactive.assertInertiaPropsContains({ settings: { legalStorage: 'inactive' } })
  })

  test('a read that fails on save warns, and the setting reads as not yet known', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    // Openapi doesn't know the fiscal id
    openapi.on('GET', `/business_registry_configurations/${FISCAL_ID}`, 'notFound')
    await completeCompany()

    const response = await client
      .put('/instance')
      .form(openapiFields)
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)

    response.assertFlashMessage(
      'warning',
      it('flash.legalStorageNotRead', { detail: 'Openapi 404: Not Found' })
    )
    response.assertFlashMissing('success')
    const settings = await InstanceSettings.findOrFail(1)
    assert.isNull(settings.sdiLegalStorage)
    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({ settings: { legalStorage: 'unknown' } })
  })

  test('another account (mode, environment or token) forgets the setting read', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await completeCompany()
    await client.put('/instance').form(openapiFields).withCsrfToken().loginAs(superuser)
    const settings = await InstanceSettings.findOrFail(1)
    assert.isTrue(settings.sdiLegalStorage)

    // Manual mode: nothing is read, and nothing is kept
    await client
      .put('/instance')
      .form({ ...openapiFields, sdiMode: 'manual', openapiToken: '' })
      .withCsrfToken()
      .loginAs(superuser)
    await settings.refresh()
    assert.isNull(settings.sdiLegalStorage)
    assert.isNull(settings.sdiLegalStorageReadAt)
    // The settings' own gateway, not the fake: the manual one
    SdiConnection.restore()
    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({ settings: { legalStorage: 'manual' } })
    SdiConnection.use(openapi.gateway())

    // Unchanged settings saved again keep what was read
    await client.put('/instance').form(openapiFields).withCsrfToken().loginAs(superuser)
    const reads = () =>
      openapi.requests.filter((request) => request.path.startsWith('/business_registry')).length
    const before = reads()
    flag = null
    await client
      .put('/instance')
      .form({ ...openapiFields, openapiToken: '' })
      .withCsrfToken()
      .loginAs(superuser)
    assert.equal(reads(), before + 1)
    await settings.refresh()
    // The read failed (no flag in the answer): the last one stays
    assert.isTrue(settings.sdiLegalStorage)
  })
})
