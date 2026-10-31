import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type Invoice from '#models/invoice'
import Charges from '#services/charges'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'
import SdiConnection from '#services/sdi_connection'
import SdiPolling from '#services/sdi_polling'
import { supplierInvoiceIntake, supplierInvoicesIntake } from '#services/supplier_invoice_intake'
import type { ScreenAction } from '#shared/screen_actions'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { FakeOpenapi } from '#tests/helpers/openapi'
import { vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

/** The Invoice screen's props, as the role sees them */
async function screenOf(client: ApiClient, path: string, role: 'office' | 'admin' = 'office') {
  const page = await client
    .get(path)
    .withInertia()
    .loginAs(await createUser(role))
  page.assertStatus(200)
  return page.inertiaProps as { actions: ScreenAction[]; previewItems: boolean }
}
const ranked = (actions: ScreenAction[]) => actions.map((action) => `${action.name}:${action.rank}`)
const named = (actions: ScreenAction[], name: string) =>
  actions.find((action) => action.name === name)!

/** A direct sale with one priced line */
async function draft() {
  const invoice = await Invoices.create(await createCustomer())
  const standard = await vatCode()
  await Invoices.save(invoice, {
    lines: [{ description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id }],
  })
  return invoice
}

async function delivered(invoice: Invoice) {
  await Invoices.finalise(invoice)
  await Submissions.prepare(invoice)
  await Submissions.confirm(invoice, 'Sconto')
  await Submissions.recordOutcome(invoice, { outcome: 'delivered' })
}

test.group('Invoice screen actions (#241)', (group) => {
  group.each.setup(async () => {
    await completeCompany()
  })

  test('a new Invoice: creating the draft is its Save', async ({ client, assert }) => {
    const { actions } = await screenOf(client, '/invoices/create')
    assert.deepEqual(ranked(actions), ['save:primary'])
    assert.equal(actions[0].label, it('ui.invoices.create'))
    assert.equal(actions[0].kind, 'submit')
  })

  test('a draft: finalising is the primary, asked first; Save beside it; deleting in "⋯"', async ({
    client,
    assert,
  }) => {
    const invoice = await draft()
    for (const role of ['office', 'admin'] as const) {
      const { actions, previewItems } = await screenOf(client, `/invoices/${invoice.id}/edit`, role)
      assert.deepEqual(ranked(actions), ['finalise:primary', 'save:secondary', 'delete:overflow'])
      assert.isTrue(previewItems)
      const finalise = named(actions, 'finalise')
      assert.equal(finalise.href, `/invoices/${invoice.id}/finalise`)
      assert.equal(finalise.confirm, it('ui.invoices.finaliseConfirm'))
      assert.isNull(finalise.disabledReason)
      assert.equal(named(actions, 'save').form, 'invoice-form')
      const remove = named(actions, 'delete')
      assert.equal(remove.method, 'delete')
      assert.isTrue(remove.destructive)
      assert.equal(remove.confirm, it('ui.invoices.deleteConfirm'))
    }
  })

  test('an empty draft stays finalisable only once it has lines', async ({ client, assert }) => {
    const invoice = await Invoices.create(await createCustomer())
    const { actions } = await screenOf(client, `/invoices/${invoice.id}/edit`)
    assert.equal(named(actions, 'finalise').disabledReason, it('ui.invoices.finaliseNoLines'))
  })

  test('finalising names the issued Invoices still to send', async ({ client, assert }) => {
    const waiting = await draft()
    await Invoices.finalise(waiting)
    const invoice = await draft()
    const { actions } = await screenOf(client, `/invoices/${invoice.id}/edit`)
    assert.include(
      named(actions, 'finalise').confirm!,
      it('ui.invoices.unsubmittedWarning', { count: 1 })
    )
  })

  test('issued: its Submission step by step, the PDF a file to view, the XML one to download', async ({
    client,
    assert,
  }) => {
    const invoice = await draft()
    await Invoices.finalise(invoice)
    const path = `/invoices/${invoice.id}/edit`

    const finalised = await screenOf(client, path)
    assert.deepEqual(ranked(finalised.actions), ['prepareSubmission:primary', 'pdf:secondary'])
    const pdf = named(finalised.actions, 'pdf')
    assert.equal(pdf.href, `/invoices/${invoice.id}/pdf`)
    assert.equal(pdf.file, 'view')

    await Submissions.prepare(invoice)
    const prepared = await screenOf(client, path)
    assert.deepEqual(ranked(prepared.actions), [
      'confirmSubmission:primary',
      'pdf:secondary',
      'xml:overflow',
    ])
    assert.equal(
      named(prepared.actions, 'confirmSubmission').confirm,
      it('ui.invoices.confirmUploadConfirm')
    )
    assert.equal(named(prepared.actions, 'xml').file, 'download')

    // Once sent, the file as it went is in the SDI history, not rebuilt
    await Submissions.confirm(invoice, 'Sconto')
    const submitted = await screenOf(client, path)
    assert.deepEqual(ranked(submitted.actions), ['recordOutcome:primary', 'pdf:secondary'])

    // Rejected: corrected and sent again, its Save no longer a draft's
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })
    const rejected = await screenOf(client, path)
    assert.deepEqual(ranked(rejected.actions), [
      'prepareSubmission:primary',
      'save:secondary',
      'pdf:secondary',
    ])
    assert.equal(named(rejected.actions, 'save').label, it('ui.invoices.saveChanges'))
  })

  test('delivered: a Credit Note can be drafted; the Credit Note finalises as one', async ({
    client,
    assert,
  }) => {
    const invoice = await draft()
    await delivered(invoice)
    const { actions } = await screenOf(client, `/invoices/${invoice.id}/edit`)
    assert.deepEqual(ranked(actions), ['pdf:secondary', 'creditNote:secondary'])
    assert.equal(named(actions, 'creditNote').href, `/invoices/${invoice.id}/credit-notes`)

    const note = await Invoices.createCreditNote(invoice)
    const noteScreen = await screenOf(client, `/invoices/${note.id}/edit`)
    assert.deepEqual(ranked(noteScreen.actions), [
      'finalise:primary',
      'save:secondary',
      'delete:overflow',
    ])
    assert.equal(named(noteScreen.actions, 'finalise').label, it('ui.invoices.finaliseCreditNote'))
    assert.equal(
      named(noteScreen.actions, 'delete').confirm,
      it('ui.invoices.deleteCreditNoteConfirm')
    )
  })

  test('a draft from a Job can be organised again, in "⋯"; an Advance Invoice can not', async ({
    client,
    assert,
  }) => {
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    await Charges.add(
      job,
      { description: 'Lavori', quantity: '1', unit: null, unitPrice: '100', vatKind: 'labour' },
      await createUser('office')
    )
    const fromJob = await Invoices.fromJob(job)
    const { actions } = await screenOf(client, `/invoices/${fromJob.id}/edit`)
    assert.deepEqual(ranked(actions), [
      'finalise:primary',
      'save:secondary',
      'organise:overflow',
      'delete:overflow',
    ])
    const organise = named(actions, 'organise')
    assert.equal(organise.kind, 'dialog')
    assert.equal(organise.label, it('ui.invoices.organise'))

    const advance = await Invoices.createAdvance(job)
    const advanceScreen = await screenOf(client, `/invoices/${advance.id}/edit`)
    assert.deepEqual(ranked(advanceScreen.actions), [
      'finalise:primary',
      'save:secondary',
      'delete:overflow',
    ])
  })

  test('a delivered Advance Invoice: its PDF, and a Credit Note for what is left of it', async ({
    client,
    assert,
  }) => {
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const advance = await Invoices.createAdvance(job)
    const [line] = await advance.related('lines').query()
    await Invoices.save(advance, {
      lines: [
        {
          id: line.id,
          description: line.description,
          quantity: '1',
          unitPrice: '500',
          vatCodeId: line.vatCodeId,
        },
      ],
    })
    await delivered(advance)
    const { actions } = await screenOf(client, `/invoices/${advance.id}/edit`)
    assert.deepEqual(ranked(actions), ['pdf:secondary', 'creditNote:secondary'])
  })
})

test.group('Invoice screen actions through Openapi (#241)', (group) => {
  let openapi: FakeOpenapi
  group.each.setup(async () => {
    await completeCompany()
    openapi = new FakeOpenapi()
      .on('GET', '/invoices', 'emptyPage')
      .on('POST', '/invoices', 'sent')
      .keepsApiConfigurations()
      .registers('01987654322', false)
    SdiConnection.use(openapi.gateway())
    SdiPolling.registered = null
    supplierInvoiceIntake.current = null
    return () => {
      SdiConnection.restore()
      supplierInvoiceIntake.current = supplierInvoicesIntake
    }
  })

  test('the app sends it, asked first; its outcome, polled, is recorded by hand only from "⋯"', async ({
    client,
    assert,
  }) => {
    const invoice = await draft()
    await Invoices.finalise(invoice)
    await Submissions.prepare(invoice)
    const path = `/invoices/${invoice.id}/edit`

    const prepared = await screenOf(client, path)
    assert.deepEqual(ranked(prepared.actions), [
      'confirmSubmission:primary',
      'pdf:secondary',
      'xml:overflow',
    ])
    const send = named(prepared.actions, 'confirmSubmission')
    assert.equal(send.label, it('ui.invoices.send'))
    assert.equal(send.confirm, it('ui.invoices.sendConfirm'))

    await Submissions.confirm(invoice, 'Sconto')
    const sent = await screenOf(client, path)
    assert.deepEqual(ranked(sent.actions), ['recordOutcome:overflow', 'pdf:secondary'])
  })
})
