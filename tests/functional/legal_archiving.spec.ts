import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'
import InstanceSettings from '#models/instance_settings'
import InvoiceSubmission from '#models/invoice_submission'
import Invoices from '#services/invoices'
import { FakeSdiGateway, SdiSendRefusedError } from '#services/sdi_gateway'
import SdiConnection, { supportsLegalArchiving } from '#services/sdi_connection'
import { FakeOpenapi, recorded } from '#tests/helpers/openapi'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

const UUID = 'cb1e9d7b-a7f5-49f4-8abb-9111467891fd'
const OTHER_UUID = '0f6e8a52-3c1d-4b7e-9a2f-5d4c3b2a1908'

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

async function archivingSetting(on: boolean) {
  const settings = await InstanceSettings.current()
  settings.sdiLegalArchiving = on
  await settings.save()
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

test.group('Legal archiving through the intermediary: sending', (group) => {
  let gateway: FakeSdiGateway
  group.each.setup(() => {
    gateway = new FakeSdiGateway()
    SdiConnection.use(gateway)
    return () => SdiConnection.restore()
  })

  test('with the setting on, the file is sent with archiving requested and the Submission records it', async ({
    client,
    assert,
  }) => {
    gateway.legalArchiving = true
    await archivingSetting(true)
    const office = await createUser('office')
    await completeCompany()
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

  test('with the setting off, or an intermediary without archiving, sending is unchanged', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()

    // Off, with an intermediary that offers it
    gateway.legalArchiving = true
    await archivingSetting(false)
    const first = await finalised()
    await send(client, office, first.id)

    // On, with an intermediary that doesn't
    gateway.legalArchiving = false
    await archivingSetting(true)
    const second = await finalised()
    await send(client, office, second.id)

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

  test('a refused send records no archiving; the next send asks again', async ({
    client,
    assert,
  }) => {
    gateway.legalArchiving = true
    await archivingSetting(true)
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()

    gateway.failNext = new SdiSendRefusedError('402 credit')
    const refused = await send(client, office, invoice.id)
    refused.assertFlashMessage('error', it('flash.submissionSendRefused', { detail: '402 credit' }))
    const [submission] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.isFalse(submission.legalArchiving)
    assert.isNull(submission.submittedAt)

    await send(client, office, invoice.id)
    await submission.refresh()
    assert.isTrue(submission.legalArchiving)
    assert.deepEqual(
      gateway.submitted.map((file) => file.legalArchiving),
      [true]
    )
  })
})

test.group('Legal archiving through Openapi', (group) => {
  group.each.teardown(() => SdiConnection.restore())

  test('Openapi offers it; the manual mode does not', ({ assert }) => {
    assert.isTrue(new FakeOpenapi().gateway().legalArchiving)
    assert.isTrue(supportsLegalArchiving('openapi'))
    assert.isFalse(supportsLegalArchiving('manual'))
    assert.isFalse(new FakeSdiGateway().legalArchiving)
  })

  test('requested, the file goes to POST /invoices_legal_storage; otherwise to POST /invoices', async ({
    client,
    assert,
  }) => {
    const openapi = new FakeOpenapi()
      .on('POST', '/invoices', () => {
        const sent = recorded('sent')
        sent.body.data.uuid = OTHER_UUID
        return sent
      })
      .on('POST', '/invoices_legal_storage', 'sent')
    SdiConnection.use(openapi.gateway())
    const office = await createUser('office')
    await completeCompany()

    await archivingSetting(true)
    const archived = await finalised()
    const archivedSent = await send(client, office, archived.id)
    archivedSent.assertFlashMessage('success', it('flash.submissionSent'))
    await archivingSetting(false)
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
})

test.group('Legal archiving: Instance setting', (group) => {
  // Saving Openapi mode registers the receiving callback: never live here
  group.each.setup(() => {
    SdiConnection.use(new FakeOpenapi().keepsApiConfigurations().gateway())
    return () => SdiConnection.restore()
  })

  const openapiFields = {
    sdiMode: 'openapi',
    sdiEnvironment: 'sandbox',
    pollingMinutes: '30',
    openapiToken: 'oat_secret_123',
  }

  test('offered with Openapi, off by default, and saved by the Superuser', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    // A fiscal id, so the receiving callback registers and the save confirms
    await completeCompany()

    const manual = await client.get('/instance').withInertia().loginAs(superuser)
    manual.assertInertiaPropsContains({
      settings: { legalArchivingOffered: false, legalArchiving: false },
    })

    await client.put('/instance').form(openapiFields).withCsrfToken().loginAs(superuser)
    const settings = await InstanceSettings.findOrFail(1)
    assert.isFalse(settings.sdiLegalArchiving)
    const offered = await client.get('/instance').withInertia().loginAs(superuser)
    offered.assertInertiaPropsContains({
      settings: { legalArchivingOffered: true, legalArchiving: false },
    })

    const response = await client
      .put('/instance')
      .form({ ...openapiFields, sdiLegalArchiving: 'true' })
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.instanceSaved'))
    assert.isUndefined(response.flashMessage('warning'))
    await settings.refresh()
    assert.isTrue(settings.sdiLegalArchiving)
    const on = await client.get('/instance').withInertia().loginAs(superuser)
    on.assertInertiaPropsContains({
      settings: { legalArchivingOffered: true, legalArchiving: true },
    })

    // Unticked, it goes off
    await client.put('/instance').form(openapiFields).withCsrfToken().loginAs(superuser)
    await settings.refresh()
    assert.isFalse(settings.sdiLegalArchiving)
  })

  test('switching to a mode without archiving turns it off, with a warning', async ({
    client,
    assert,
  }) => {
    const superuser = await createUser('superuser')
    await client
      .put('/instance')
      .form({ ...openapiFields, sdiLegalArchiving: 'true' })
      .withCsrfToken()
      .loginAs(superuser)
    const settings = await InstanceSettings.findOrFail(1)
    assert.isTrue(settings.sdiLegalArchiving)

    const response = await client
      .put('/instance')
      .form({ ...openapiFields, sdiMode: 'manual', sdiLegalArchiving: 'true' })
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    response.assertFlashMessage('warning', it('flash.legalArchivingOff'))
    response.assertFlashMissing('success')
    await settings.refresh()
    assert.equal(settings.sdiMode, 'manual')
    assert.isFalse(settings.sdiLegalArchiving)

    // Already off: nothing to warn about
    const again = await client
      .put('/instance')
      .form({ ...openapiFields, sdiMode: 'manual' })
      .withCsrfToken()
      .loginAs(superuser)
      .redirects(0)
    assert.isUndefined(again.flashMessage('warning'))
    again.assertFlashMessage('success', it('flash.instanceSaved'))
    const page = await client.get('/instance').withInertia().loginAs(superuser)
    page.assertInertiaPropsContains({
      settings: { legalArchivingOffered: false, legalArchiving: false },
    })
  })
})
