import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type { ScreenAction } from '#shared/screen_actions'
import SupplierInvoices from '#services/supplier_invoices'
import LegalStorage from '#services/legal_storage'
import SdiConnection from '#services/sdi_connection'
import { FakeSdiGateway } from '#services/sdi_gateway'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'
import { supplierInvoiceXml } from '#tests/helpers/supplier_invoices'

/** The Supplier Invoice page's header actions (docs/ui.md "Actions") */
async function actionsOf(client: ApiClient, id: number, role: 'office' | 'admin' = 'office') {
  const page = await client
    .get(`/supplier-invoices/${id}`)
    .withInertia()
    .loginAs(await createUser(role))
  page.assertStatus(200)
  return page.inertiaProps.actions as ScreenAction[]
}
const ranked = (actions: ScreenAction[]) =>
  actions.map((action) => `${action.name}:${action.rank}:${action.kind}`)

/** Office uploads the fixture, through the intake */
async function uploaded() {
  const [invoice] = await SupplierInvoices.receive(
    { contents: Buffer.from(supplierInvoiceXml(), 'utf8'), name: 'fattura.xml' },
    { via: 'upload', user: await createUser('office') }
  )
  return invoice
}

test.group('Supplier Invoice screen actions (#243)', (group) => {
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

  test('the original file, a file link; no archiving when the account doesn’t archive', async ({
    client,
    assert,
  }) => {
    const invoice = await uploaded()

    for (const role of ['office', 'admin'] as const) {
      const actions = await actionsOf(client, invoice.id, role)
      assert.deepEqual(ranked(actions), ['file:secondary:link'])
      assert.equal(actions[0].label, it('ui.supplierInvoices.downloadFile'))
      assert.equal(actions[0].href, `/supplier-invoices/${invoice.id}/file`)
      assert.equal(actions[0].file, 'download')
    }
  })

  test('an upload waiting for archiving: SDI’s identifier asked in a dialog, or sent at once', async ({
    client,
    assert,
  }) => {
    gateway.legalStorage = true
    await LegalStorage.refresh(gateway)
    // No identifier on an upload: marked failed until Office gives it (ADR 0019)
    const invoice = await uploaded()
    await invoice.refresh()
    assert.equal(invoice.legalArchiving, 'failed')

    const asking = await actionsOf(client, invoice.id)
    assert.deepEqual(ranked(asking), ['file:secondary:link', 'archive:secondary:dialog'])
    assert.equal(asking[1].label, it('ui.supplierInvoices.legalArchivingSend'))

    // With the identifier known, it posts
    invoice.sdiIdentifier = '1084646898320'
    await invoice.save()
    const sending = await actionsOf(client, invoice.id)
    assert.deepEqual(ranked(sending), ['file:secondary:link', 'archive:secondary:post'])
    assert.equal(sending[1].href, `/supplier-invoices/${invoice.id}/legal-archiving`)

    // Requested: nothing to send
    await invoice
      .merge({
        legalArchiving: 'requested',
        legalArchivingIds: ['fake-1'],
        legalArchivingFailure: null,
      })
      .save()
    assert.deepEqual(ranked(await actionsOf(client, invoice.id)), ['file:secondary:link'])
  })
})
