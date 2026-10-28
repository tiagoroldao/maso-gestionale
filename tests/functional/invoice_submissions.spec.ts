import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import InvoiceLine from '#models/invoice_line'
import InvoiceSubmission from '#models/invoice_submission'
import StockMovement from '#models/stock_movement'
import CompanySettings from '#models/company_settings'
import Customer from '#models/customer'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'
import { FakeSdiGateway, ManualSdiGateway } from '#services/sdi_gateway'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import type Item from '#models/item'

async function finalised(item?: Item, quantity = '2') {
  const invoice = await Invoices.create(await createCustomer())
  const standard = await vatCode()
  await Invoices.save(invoice, {
    lines: [
      item
        ? {
            itemId: item.id,
            description: 'Rubinetto',
            quantity,
            unitPrice: '50',
            vatCodeId: standard.id,
          }
        : { description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id },
    ],
  })
  await Invoices.finalise(invoice)
  await invoice.refresh()
  return invoice
}

test.group('SDI Submissions', (group) => {
  let gateway: FakeSdiGateway
  group.each.setup(() => {
    gateway = new FakeSdiGateway()
    Submissions.gateway = gateway
    return () => {
      Submissions.gateway = new ManualSdiGateway()
    }
  })

  test('prepare, download, confirm the upload, then record delivery', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany({ taxCode: '01987654322' })
    const invoice = await finalised()

    await client.post(`/invoices/${invoice.id}/submissions`).withCsrfToken().loginAs(office)
    const [prepared] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.match(prepared.progressive, /^M[0-9A-Z]{4}$/)
    assert.equal(prepared.fileName, `IT01987654322_${prepared.progressive}.xml`)

    const xml = await client.get(`/invoices/${invoice.id}/xml`).loginAs(office)
    xml.assertStatus(200)
    assert.include(xml.header('content-disposition'), prepared.fileName)
    assert.include(xml.text(), `<ProgressivoInvio>${prepared.progressive}</ProgressivoInvio>`)

    await client.post(`/invoices/${invoice.id}/submissions/confirm`).withCsrfToken().loginAs(office)
    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')
    assert.deepEqual(
      gateway.submitted.map((file) => file.fileName),
      [prepared.fileName]
    )

    const outcome = await client
      .post(`/invoices/${invoice.id}/submissions/outcome`)
      .form({ outcome: 'delivered' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    outcome.assertFlashMessage('success', it('flash.submissionOutcome.delivered'))
    await invoice.refresh()
    assert.equal(invoice.status, 'delivered')
    await prepared.refresh()
    assert.equal(prepared.outcome, 'delivered')
    assert.isNotNull(prepared.submittedAt)
    assert.equal(prepared.noticeOn?.toISODate(), DateTime.now().toISODate())

    // The file sent stays downloadable, exactly as sent
    assert.equal(prepared.xml, gateway.submitted[0].xml)
    const sent = await client
      .get(`/invoices/${invoice.id}/submissions/${prepared.id}/xml`)
      .loginAs(office)
    sent.assertStatus(200)
    assert.include(sent.header('content-disposition'), prepared.fileName)
    assert.equal(sent.text(), gateway.submitted[0].xml)
  })

  test("the resubmission deadline counts from the date of SDI's notice", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()
    const submission = await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    // Uploaded a week ago; the Rejection is recorded three days late
    await InvoiceSubmission.query()
      .where('id', submission.id)
      .update({ submitted_at: DateTime.now().minus({ days: 7 }).toSQL() })
    const noticeOn = DateTime.now().minus({ days: 3 }).toISODate()!

    await client
      .post(`/invoices/${invoice.id}/submissions/outcome`)
      .form({ outcome: 'rejected', noticeOn, sdiId: '123456789' })
      .withCsrfToken()
      .loginAs(office)

    await submission.refresh()
    assert.equal(submission.noticeOn?.toISODate(), noticeOn)
    assert.equal(submission.sdiId, '123456789')
    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      resubmitBy: DateTime.now().plus({ days: 2 }).toISODate(),
      submissions: [{ noticeOn, sdiId: '123456789', hasFile: true }],
    })
  })

  test('a notice can be neither in the future nor before the upload', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')

    const tomorrow = await client
      .post(`/invoices/${invoice.id}/submissions/outcome`)
      .form({ outcome: 'delivered', noticeOn: DateTime.now().plus({ days: 1 }).toISODate() })
      .header('referer', `/invoices/${invoice.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(tomorrow.flashMessage('inputErrorsBag'), ['noticeOn'])

    const early = await client
      .post(`/invoices/${invoice.id}/submissions/outcome`)
      .form({ outcome: 'delivered', noticeOn: DateTime.now().minus({ days: 1 }).toISODate() })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    early.assertFlashMessage('error', it('flash.noticeBeforeSubmission'))

    const badId = await client
      .post(`/invoices/${invoice.id}/submissions/outcome`)
      .form({ outcome: 'delivered', sdiId: 'abc' })
      .header('referer', `/invoices/${invoice.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(badId.flashMessage('inputErrorsBag'), ['sdiId'])

    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')
    const [open] = await InvoiceSubmission.query().where('invoiceId', invoice.id)
    assert.isNull(open.outcome)
    assert.isNull(open.noticeOn)
  })

  test('only files actually sent are kept, each under its own Invoice', async ({ client }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()
    const other = await finalised()
    const prepared = await Submissions.prepare(invoice)

    // Prepared, not sent yet: nothing kept
    const unsent = await client
      .get(`/invoices/${invoice.id}/submissions/${prepared.id}/xml`)
      .loginAs(office)
    unsent.assertStatus(404)

    await Submissions.confirm(invoice, 'Sconto')
    const elsewhere = await client
      .get(`/invoices/${other.id}/submissions/${prepared.id}/xml`)
      .loginAs(office)
    elsewhere.assertStatus(404)
  })

  test('a Rejection reopens the Invoice: corrected, rebooked in stock and resubmitted', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const item = await createItem({ code: 'RUB-1' })
    const other = await createItem({ code: 'VAL-1' })
    const invoice = await finalised(item, '2')
    const number = invoice.formattedNumber
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await client
      .post(`/invoices/${invoice.id}/submissions/outcome`)
      .form({ outcome: 'rejected', notes: '00305 IdFiscaleIVA non valido' })
      .withCsrfToken()
      .loginAs(office)

    await invoice.refresh()
    assert.equal(invoice.status, 'rejected')
    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      editable: true,
      resubmitBy: DateTime.now().plus({ days: 5 }).toISODate(),
      submissions: [{ outcome: 'rejected', outcomeNotes: '00305 IdFiscaleIVA non valido' }],
    })

    // Corrected: one RUB-1 fewer, one VAL-1 added; number and date stay,
    // and so does the RUB-1 line
    const standard = await vatCode()
    const original = await InvoiceLine.findByOrFail('invoiceId', invoice.id)
    await client
      .put(`/invoices/${invoice.id}`)
      .json({
        lines: [
          {
            id: original.id,
            itemId: item.id,
            description: 'Rubinetto',
            quantity: '1',
            unitPrice: '50',
            vatCodeId: standard.id,
          },
          {
            itemId: other.id,
            description: 'Valvola',
            quantity: '1',
            unitPrice: '8',
            vatCodeId: standard.id,
          },
        ],
      })
      .withCsrfToken()
      .loginAs(office)
    await invoice.refresh()
    assert.equal(invoice.formattedNumber, number)
    assert.equal(invoice.status, 'rejected')
    await original.refresh()
    assert.equal(original.quantity, '1.000')
    const movements = await StockMovement.query()
      .whereIn('itemId', [item.id, other.id])
      .orderBy('id')
    assert.deepEqual(
      movements.map((m) => [m.itemId, m.kind, m.quantity]),
      [
        [item.id, 'sale', '-2.000'],
        [item.id, 'adjustment', '1.000'],
        [other.id, 'sale', '-1.000'],
      ]
    )

    // Resubmitted with a new file name
    await client.post(`/invoices/${invoice.id}/submissions`).withCsrfToken().loginAs(office)
    await client.post(`/invoices/${invoice.id}/submissions/confirm`).withCsrfToken().loginAs(office)
    const submissions = await InvoiceSubmission.query().where('invoiceId', invoice.id).orderBy('id')
    assert.lengthOf(submissions, 2)
    assert.notEqual(submissions[0].progressive, submissions[1].progressive)
    await invoice.refresh()
    assert.equal(invoice.status, 'submitted')
  })

  test('correcting a Rejection takes the current Customer data, keeping number and date', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()
    const issuedOn = invoice.issuedOn?.toISODate()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, {
      outcome: 'rejected',
      notes: '00305 IdFiscaleIVA non valido',
    })

    // Office fixes the Customer's VAT number, then saves the Invoice again
    const customer = await Customer.findOrFail(invoice.customerId)
    customer.vatNumber = '01987654322'
    await customer.save()
    const standard = await vatCode()
    await client
      .put(`/invoices/${invoice.id}`)
      .json({
        lines: [
          { description: 'Intervento', quantity: '1', unitPrice: '100', vatCodeId: standard.id },
        ],
      })
      .withCsrfToken()
      .loginAs(office)

    await invoice.refresh()
    assert.equal(invoice.customerSnapshot?.vatNumber, '01987654322')
    assert.equal(invoice.number, 1)
    assert.equal(invoice.issuedOn?.toISODate(), issuedOn)
    const submission = await Submissions.prepare(invoice)
    const xml = await Submissions.xml(invoice, submission, 'Sconto')
    assert.include(xml, '<IdCodice>01987654322</IdCodice>')
  })

  test('a prepared Submission freezes the Invoice; an empty one is never sent', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const invoice = await finalised()
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })
    await Submissions.prepare(invoice)

    const standard = await vatCode()
    const frozen = await client
      .put(`/invoices/${invoice.id}`)
      .json({
        lines: [{ description: 'Altro', quantity: '1', unitPrice: '1', vatCodeId: standard.id }],
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    frozen.assertFlashMessage('error', it('flash.invoiceNotEditable'))

    // A double-clicked confirm is harmless
    for (let i = 0; i < 2; i++) {
      const confirm = await client
        .post(`/invoices/${invoice.id}/submissions/confirm`)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      confirm.assertFlashMessage('success', it('flash.submissionConfirmed'))
    }

    // Rejected again, emptied: it can't be prepared
    await Submissions.recordOutcome(invoice, { outcome: 'rejected' })
    await client.put(`/invoices/${invoice.id}`).json({ lines: [] }).withCsrfToken().loginAs(office)
    const empty = await client
      .post(`/invoices/${invoice.id}/submissions`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    empty.assertFlashMessage('error', it('flash.submissionRefused'))
    assert.lengthOf(await InvoiceSubmission.query().where('invoiceId', invoice.id), 2)
  })

  test('each step only applies at its stage', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const draft = await Invoices.create(await createCustomer())
    const invoice = await finalised()

    const refusals = [
      client.post(`/invoices/${draft.id}/submissions`),
      client.post(`/invoices/${invoice.id}/submissions/confirm`),
      client.post(`/invoices/${invoice.id}/submissions/outcome`).form({ outcome: 'delivered' }),
    ]
    for (const request of refusals) {
      const response = await request.withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.submissionRefused'))
    }
    const noFile = await client.get(`/invoices/${invoice.id}/xml`).loginAs(office)
    noFile.assertStatus(404)

    // Not deliverable is final: it still counts, there is nothing to resend
    await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    await Submissions.recordOutcome(invoice, { outcome: 'not_deliverable' })
    const again = await client
      .post(`/invoices/${invoice.id}/submissions`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    again.assertFlashMessage('error', it('flash.submissionRefused'))
    const edit = await client
      .put(`/invoices/${invoice.id}`)
      .json({ lines: [] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    edit.assertFlashMessage('error', it('flash.invoiceNotEditable'))
    await invoice.refresh()
    assert.equal(invoice.status, 'not_deliverable')
  })

  test('finalising warns about Invoices not yet sent; lists show each stage', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const waiting = await finalised()
    const sent = await finalised()
    await Submissions.prepare(sent)
    await Submissions.confirm(sent, 'Sconto')
    const draft = await Invoices.create(await createCustomer())

    const page = await client.get(`/invoices/${draft.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ unsubmittedCount: 1 })

    // A rejected Invoice also waits to go back to SDI
    await Submissions.recordOutcome(sent, { outcome: 'rejected' })
    const again = await client.get(`/invoices/${draft.id}/edit`).withInertia().loginAs(office)
    again.assertInertiaPropsContains({ unsubmittedCount: 2 })

    for (const [stage, ids] of [
      ['draft', [draft.id]],
      ['finalised', [waiting.id]],
      ['submitted', []],
      ['rejected', [sent.id]],
    ] as const) {
      const list = await client.get('/invoices').qs({ stage }).withInertia().loginAs(office)
      const listed = (list.inertiaProps.invoices as { id: number }[]).map((i) => i.id)
      assert.deepEqual(listed, [...ids], stage)
    }
  })

  test('Technicians and the Superuser are refused every Submission step', async ({
    client,
    assert,
  }) => {
    await completeCompany()
    const invoice = await finalised()

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const request of [
        client.post(`/invoices/${invoice.id}/submissions`),
        client.post(`/invoices/${invoice.id}/submissions/confirm`),
        client.post(`/invoices/${invoice.id}/submissions/outcome`).form({ outcome: 'delivered' }),
      ]) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.lengthOf(await InvoiceSubmission.all(), 0)

    // Nor can they download a file that was sent
    const submission = await Submissions.prepare(invoice)
    await Submissions.confirm(invoice, 'Sconto')
    for (const role of ['technician', 'superuser'] as const) {
      const response = await client
        .get(`/invoices/${invoice.id}/submissions/${submission.id}/xml`)
        .loginAs(await createUser(role))
      response.assertStatus(403)
    }
  })

  test('only the Admin sets the SDI file letter', async ({ client, assert }) => {
    await completeCompany()
    for (const role of ['office', 'technician', 'superuser'] as const) {
      const user = await createUser(role)
      const response = await client
        .put('/settings/invoice-numbering/sdi-prefix')
        .form({ sdiFilePrefix: 'Z' })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.sdiFilePrefix, 'M')
  })

  test('the Admin sets the letter SDI files start with', async ({ client, assert }) => {
    const admin = await createUser('admin')
    await completeCompany()

    await client
      .put('/settings/invoice-numbering/sdi-prefix')
      .form({ sdiFilePrefix: 'q' })
      .withCsrfToken()
      .loginAs(admin)
    const settings = await CompanySettings.findOrFail(1)
    assert.equal(settings.sdiFilePrefix, 'Q')

    const invoice = await finalised()
    const submission = await Submissions.prepare(invoice)
    assert.isTrue(submission.progressive.startsWith('Q'))
  })
})
