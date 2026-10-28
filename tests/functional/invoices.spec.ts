import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

async function setup() {
  const office = await createUser('office')
  const customer = await createCustomer({ name: 'Bar Centrale' })
  const item = await createItem({ code: 'RUB-1', unit: 'pz', resalePrice: '45' })
  const standard = await vatCode('22%')
  const reduced = await vatCode('10%')
  const reverse = await vatCode('Inversione contabile – impianti su edifici')
  const invoice = await Invoice.create({ customerId: customer.id, status: 'draft' })
  return { office, customer, item, standard, reduced, reverse, invoice }
}

function save(client: ApiClient, invoice: Invoice, body: object) {
  return client.put(`/invoices/${invoice.id}`).json(body).withCsrfToken()
}

const lines = (invoice: Invoice) =>
  InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')

test.group('Draft Invoices', () => {
  test('Office starts a draft for a Customer; it has no number', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()

    const response = await client
      .post('/invoices')
      .form({ customerId: String(customer.id) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    const invoice = await Invoice.firstOrFail()
    response.assertHeader('location', `/invoices/${invoice.id}/edit`)
    assert.equal(invoice.customerId, customer.id)
    assert.equal(invoice.status, 'draft')
    assert.isNull(invoice.number)
  })

  test('saving prices the lines and copies the VAT treatment onto them', async ({
    client,
    assert,
  }) => {
    const { office, item, standard, reverse, invoice } = await setup()

    const response = await save(client, invoice, {
      discountPercent: '10',
      notes: 'Pagamento a vista',
      lines: [
        {
          itemId: item.id,
          description: 'Rubinetto',
          quantity: '2',
          unitPrice: '45',
          discountPercent: '5',
          vatCodeId: standard.id,
        },
        { description: 'Posa', quantity: '1,5', unitPrice: '40', vatCodeId: reverse.id },
      ],
    })
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', `/invoices/${invoice.id}/edit`)
    const saved = await lines(invoice)
    assert.deepEqual(
      saved.map((line) => [
        line.itemId,
        line.quantity,
        line.unit,
        line.unitPrice,
        line.discountPercent,
        line.vatRate,
        line.natura,
        line.lineTotal,
      ]),
      [
        [item.id, '2.000', 'pz', '45.0000', '5.00', '22.00', null, '85.50'],
        [null, '1.500', null, '40.0000', '0.00', '0.00', 'N6.7', '60.00'],
      ]
    )
    await invoice.refresh()
    assert.equal(invoice.discountPercent, '10.00')
    assert.equal(invoice.notes, 'Pagamento a vista')

    // 145.50 less 10% = 130.95 taxable: 76.95 at 22% (VAT 16.93) + 54.00 reverse charge
    const list = await client.get('/invoices').withInertia().loginAs(office)
    list.assertInertiaPropsContains({ invoices: [{ id: invoice.id, total: '147.88' }] })
  })

  test('very large lines are stored with the same rounding as the totals', async ({
    client,
    assert,
  }) => {
    const { office, standard, invoice } = await setup()

    await save(client, invoice, {
      lines: [
        {
          description: 'Impianto',
          quantity: '60000,006',
          unitPrice: '20005,0005',
          discountPercent: '0,01',
          vatCodeId: standard.id,
        },
      ],
    }).loginAs(office)

    const [line] = await lines(invoice)
    assert.equal(line.lineTotal, '1200180120.01')
  })

  test('archived Items can not be added, but lines already on the draft keep theirs', async ({
    client,
    assert,
  }) => {
    const { office, item, standard, invoice } = await setup()
    const other = await createItem({ code: 'OLD-1' })
    await save(client, invoice, {
      lines: [
        {
          itemId: item.id,
          description: 'Rubinetto',
          quantity: '1',
          unitPrice: '45',
          vatCodeId: standard.id,
        },
      ],
    }).loginAs(office)
    for (const archived of [item, other]) {
      archived.archivedAt = DateTime.now()
      await archived.save()
    }

    const refused = await save(client, invoice, {
      lines: [
        {
          itemId: item.id,
          description: 'Rubinetto',
          quantity: '2',
          unitPrice: '45',
          vatCodeId: standard.id,
        },
        {
          itemId: other.id,
          description: 'Vecchio',
          quantity: '1',
          unitPrice: '1',
          vatCodeId: standard.id,
        },
      ],
    })
      .header('referer', `/invoices/${invoice.id}/edit`)
      .loginAs(office)
      .redirects(0)
    const errors = refused.flashMessage('inputErrorsBag') as Record<string, unknown>
    assert.deepEqual(Object.keys(errors), ['lines.1.itemId'])

    await save(client, invoice, {
      lines: [
        {
          itemId: item.id,
          description: 'Rubinetto',
          quantity: '2',
          unitPrice: '45',
          vatCodeId: standard.id,
        },
      ],
    }).loginAs(office)
    const [line] = await lines(invoice)
    assert.equal(line.quantity, '2.000')
  })

  test('later VAT Code changes leave saved lines as they were', async ({ client, assert }) => {
    const { office, reduced, invoice } = await setup()
    await save(client, invoice, {
      lines: [
        { description: 'Manutenzione', quantity: '1', unitPrice: '100', vatCodeId: reduced.id },
      ],
    }).loginAs(office)

    reduced.rate = '11'
    await reduced.save()

    const [line] = await lines(invoice)
    assert.equal(line.vatRate, '10.00')
  })

  test('rejects incomplete lines and archived VAT Codes, but keeps codes already used', async ({
    client,
    assert,
  }) => {
    const { office, reduced, standard, invoice } = await setup()
    await save(client, invoice, {
      lines: [
        { description: 'Manutenzione', quantity: '1', unitPrice: '100', vatCodeId: reduced.id },
      ],
    }).loginAs(office)
    for (const code of [reduced, standard]) {
      code.archivedAt = DateTime.now()
      await code.save()
    }

    const refused = await save(client, invoice, {
      discountPercent: '100',
      lines: [
        { description: '', quantity: '0', unitPrice: '1,2,3', vatCodeId: reduced.id },
        { description: 'Nuova', quantity: '1', unitPrice: '1', vatCodeId: standard.id },
        { description: 'Senza IVA', quantity: '1', unitPrice: '1' },
      ],
    })
      .header('referer', `/invoices/${invoice.id}/edit`)
      .loginAs(office)
      .redirects(0)
    assert.properties(refused.flashMessage('inputErrorsBag'), [
      'discountPercent',
      'lines.0.description',
      'lines.0.quantity',
      'lines.0.unitPrice',
      'lines.1.vatCodeId',
      'lines.2.vatCodeId',
    ])
    assert.notProperty(refused.flashMessage('inputErrorsBag'), 'lines.0.vatCodeId')

    await save(client, invoice, {
      lines: [
        { description: 'Manutenzione', quantity: '2', unitPrice: '100', vatCodeId: reduced.id },
      ],
    }).loginAs(office)
    const [line] = await lines(invoice)
    assert.equal(line.lineTotal, '200.00')
  })

  test('the editor offers active codes and the ones the draft uses', async ({ client, assert }) => {
    const { office, reduced, invoice } = await setup()
    await save(client, invoice, {
      lines: [
        { description: 'Manutenzione', quantity: '1', unitPrice: '100', vatCodeId: reduced.id },
      ],
    }).loginAs(office)
    reduced.archivedAt = DateTime.now()
    await reduced.save()

    const page = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    const names = (page.inertiaProps.vatCodes as { name: string }[]).map((code) => code.name)
    assert.include(names, '10%')
    assert.include(names, '22%')

    const other = await Invoice.create({ customerId: invoice.customerId, status: 'draft' })
    const otherPage = await client.get(`/invoices/${other.id}/edit`).withInertia().loginAs(office)
    const otherNames = (otherPage.inertiaProps.vatCodes as { name: string }[]).map((c) => c.name)
    assert.notInclude(otherNames, '10%')
  })

  test('a draft can be deleted, with its lines', async ({ client, assert }) => {
    const { office, standard, invoice } = await setup()
    await save(client, invoice, {
      lines: [{ description: 'Riga', quantity: '1', unitPrice: '1', vatCodeId: standard.id }],
    }).loginAs(office)

    const response = await client
      .delete(`/invoices/${invoice.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', '/invoices')
    assert.isNull(await Invoice.find(invoice.id))
    assert.lengthOf(await lines(invoice), 0)
  })

  test('Technicians can not see or change Invoices', async ({ client, assert }) => {
    const { standard, invoice, customer } = await setup()
    const technician = await createUser('technician')

    for (const url of ['/invoices', '/invoices/create', `/invoices/${invoice.id}/edit`]) {
      const page = await client.get(url).withInertia().loginAs(technician)
      page.assertStatus(403)
    }
    for (const request of [
      client.post('/invoices').form({ customerId: String(customer.id) }),
      client.put(`/invoices/${invoice.id}`).json({
        lines: [{ description: 'X', quantity: '1', unitPrice: '1', vatCodeId: standard.id }],
      }),
      client.delete(`/invoices/${invoice.id}`),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(technician)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await Invoice.all(), 1)
    assert.lengthOf(await lines(invoice), 0)
  })
})
