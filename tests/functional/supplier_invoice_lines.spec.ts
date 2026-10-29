import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import StockMovement from '#models/stock_movement'
import Supplier from '#models/supplier'
import type SupplierInvoice from '#models/supplier_invoice'
import SupplierInvoiceLine from '#models/supplier_invoice_line'
import type User from '#models/user'
import SupplierInvoices from '#services/supplier_invoices'
import { DESCRIPTION_KEY_SQL } from '#services/supplier_invoice_lines'
import { storagePath } from '#services/storage'
import StockLedger from '#stock/stock_ledger'
import { descriptionKey } from '#shared/supplier_invoices'
import { createUser } from '#tests/helpers/users'
import { completeCompany } from '#tests/helpers/company'
import { createCategory, createItem } from '#tests/helpers/items'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import {
  FIXTURE,
  supplierInvoiceXml,
  supplierInvoiceXmlWithLines,
} from '#tests/helpers/supplier_invoices'

const today = () => DateTime.now().toISODate()!

/**
 * Receives a Supplier Invoice (the fixture unless other XML is given) and
 * returns it with its lines, in order.
 */
async function invoiceWith(user: User, xml = supplierInvoiceXml()) {
  const [invoice] = await SupplierInvoices.receive(
    { contents: Buffer.from(xml, 'utf8'), name: 'fattura.xml' },
    { via: 'upload', user }
  )
  const lines = await SupplierInvoiceLine.query()
    .where('supplierInvoiceId', invoice.id)
    .orderBy('position')
  return { invoice, lines }
}

function post(client: ApiClient, user: User, url: string, form: Record<string, string> = {}) {
  return client
    .post(url)
    .form(form)
    .header('referer', '/')
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

function receive(
  client: ApiClient,
  user: User,
  line: SupplierInvoiceLine,
  form: { itemId: number; quantity: string; occurredOn?: string }
) {
  return post(client, user, `/supplier-invoice-lines/${line.id}/receipt`, {
    itemId: String(form.itemId),
    quantity: form.quantity,
    occurredOn: form.occurredOn ?? today(),
  })
}

const markNotStock = (client: ApiClient, user: User, line: SupplierInvoiceLine) =>
  post(client, user, `/supplier-invoice-lines/${line.id}/not-stock`)

const undo = (client: ApiClient, user: User, line: SupplierInvoiceLine) =>
  post(client, user, `/supplier-invoice-lines/${line.id}/undo`)

/** The lines as the invoice page receives them */
async function pageLines(client: ApiClient, user: User, invoice: SupplierInvoice) {
  const page = await client.get(`/supplier-invoices/${invoice.id}`).withInertia().loginAs(user)
  page.assertInertiaComponent('supplier_invoices/show')
  return (
    page.inertiaProps as {
      invoice: {
        lines: {
          id: number
          outcome: string | null
          item: { id: number } | null
          receipt: { quantity: string; unitCost: string | null } | null
          suggestion: { id: number } | null
          refusal: string | null
        }[]
      }
    }
  ).invoice.lines
}

test.group('Supplier Invoice lines', (group) => {
  group.each.setup(async () => {
    await completeCompany()
  })
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Items are suggested by the Supplier’s article code, then by description', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(office)
    const other = await Supplier.create({
      name: 'Altro',
      vatCountry: 'IT',
      vatNumber: '01234567897',
    })

    // The article code, for this Supplier (any case and spacing); never another Supplier's
    await createItem({ supplierId: other.id, supplierCode: 'VLV-034' })
    const unlinked = await createItem({ code: 'A-UNLINKED', supplierCode: 'VLV-034' })
    const linked = await createItem({
      code: 'Z-LINKED',
      supplierId: invoice.supplierId,
      supplierCode: ' vlv-034',
    })
    // The description, spaces and case aside; never an archived Item
    await createItem({ description: 'Raccordi e guarnizioni', archivedAt: DateTime.now() })
    const fittings = await createItem({ description: ' RACCORDI  e guarnizioni ' })

    let [valve, fitting] = await pageLines(client, office, invoice)
    assert.equal(valve.suggestion?.id, linked.id)
    assert.equal(fitting.suggestion?.id, fittings.id)
    assert.isNull(valve.refusal)

    // Without the linked one, an Item no Supplier is linked to
    await linked.merge({ supplierCode: null }).save()
    ;[valve] = await pageLines(client, office, invoice)
    assert.equal(valve.suggestion?.id, unlinked.id)

    // An earlier line of the Supplier, received onto an Item, wins over a description alike
    const earlierItem = await createItem({ code: 'EARLIER' })
    const earlier = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-OLD' }))
    const first = await receive(client, office, earlier.lines[1], {
      itemId: earlierItem.id,
      quantity: '1',
    })
    first.assertFlashMessage(
      'success',
      it('flash.supplierInvoiceLineReceived', { quantity: '1', unit: 'pz', code: 'EARLIER' })
    )
    ;[, fitting] = await pageLines(client, office, invoice)
    assert.equal(fitting.suggestion?.id, earlierItem.id)
    assert.lengthOf(lines, 2)
  })

  test('receiving a line: a receipt at its unit cost, the Item’s prices and Supplier', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(office)
    const item = await createItem({ purchasePrice: '4.8', resalePrice: '9' })

    const receivedOn = DateTime.now().minus({ days: 1 }).toISODate()!
    const response = await receive(client, office, lines[0], {
      itemId: item.id,
      quantity: '10',
      occurredOn: receivedOn,
    })
    response.assertHeader('location', `/supplier-invoices/${invoice.id}`)
    response.assertFlashMessage(
      'success',
      it('flash.supplierInvoiceLineReceived', { quantity: '10', unit: 'pz', code: item.code })
    )
    // No warning: PZ is the Item's pz, and the Item has no Category
    assert.isUndefined(response.flashMessage('warning'))

    // A receipt (carico) at the line's amount over the quantity
    const [movement] = await StockMovement.query().where('itemId', item.id)
    assert.deepInclude(movement.serialize(), {
      kind: 'receipt',
      quantity: '10.000',
      unitCost: '5.2500',
      reference: it('ui.supplierInvoices.receiptReference', {
        number: FIXTURE.number,
        supplier: FIXTURE.supplierName,
      }),
      createdBy: office.id,
    })
    assert.equal(movement.occurredOn.toISODate(), receivedOn)

    // The purchase price follows; the resale price doesn't. The Supplier and code are set
    await item.refresh()
    assert.equal(item.purchasePrice, '5.2500')
    assert.equal(item.resalePrice, '9.0000')
    assert.equal(item.supplierId, invoice.supplierId)
    assert.equal(item.supplierCode, 'VLV-034')

    // The line remembers it all; the invoice still has a line to handle
    const [line] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.deepInclude(line.serialize(), {
      outcome: 'received',
      itemId: item.id,
      stockMovementId: movement.id,
      previousPurchasePrice: '4.8000',
      setSupplierCode: true,
      handledBy: office.id,
    })
    await invoice.refresh()
    assert.equal(invoice.status, 'to_handle')
    const [received] = await pageLines(client, office, invoice)
    assert.deepInclude(received, {
      outcome: 'received',
      item: { id: item.id, code: item.code, description: item.description, unit: 'pz' },
      receipt: { quantity: '10.000', unitCost: '5.2500' },
      suggestion: null,
    })

    // The other line is shipping: not stock. Now the invoice is handled
    const notStock = await markNotStock(client, office, lines[1])
    notStock.assertFlashMessage('success', it('flash.supplierInvoiceLineNotStock'))
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')
    assert.equal(invoice.handledBy, office.id)
    assert.isNotNull(invoice.handledAt)
  })

  test('an Item’s existing Supplier and code are kept', async ({ client, assert }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(office)
    const other = await Supplier.create({
      name: 'Altro',
      vatCountry: 'IT',
      vatNumber: '01234567897',
    })
    const another = await createItem({ supplierId: other.id })
    const coded = await createItem({ supplierId: invoice.supplierId, supplierCode: 'OLD-1' })

    await receive(client, office, lines[0], { itemId: another.id, quantity: '10' })
    await another.refresh()
    // Another Supplier's Item gets no code of this Supplier's
    assert.equal(another.supplierId, other.id)
    assert.isNull(another.supplierCode)

    // An Item with a code of this Supplier's keeps it
    const second = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-2' }))
    await receive(client, office, second.lines[0], { itemId: coded.id, quantity: '10' })
    await coded.refresh()
    assert.equal(coded.supplierCode, 'OLD-1')
    const handled = await SupplierInvoiceLine.query().whereIn('id', [
      lines[0].id,
      second.lines[0].id,
    ])
    assert.isTrue(handled.every((line) => !line.setSupplierCode))

    // Undone, neither loses what it had: another Supplier's link, a code typed by hand
    await undo(client, office, lines[0])
    await undo(client, office, second.lines[0])
    await Promise.all([another.refresh(), coded.refresh()])
    assert.equal(another.supplierId, other.id)
    assert.equal(coded.supplierCode, 'OLD-1')
  })

  test('the unit cost is after the supplier’s discounts; a free line leaves the price', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { lines } = await invoiceWith(
      office,
      supplierInvoiceXmlWithLines([
        // 10 × 5.25 less 10%
        {
          code: 'VLV-034',
          description: 'Valvola',
          quantity: '10.00',
          unit: 'PZ',
          unitPrice: '5.25',
          discountPercent: '10.00',
          total: '47.25',
        },
        // Free samples
        { description: 'Omaggio', quantity: '2.00', unitPrice: '0.00', total: '0.00' },
        // 3 for 10.00: a cost of a third of a cent more than 3.33
        { description: 'Tre pezzi', quantity: '3.00', unitPrice: '3.33333333', total: '10.00' },
      ])
    )
    const valve = await createItem({ purchasePrice: '5' })
    const sample = await createItem({ purchasePrice: '7' })
    const third = await createItem()

    await receive(client, office, lines[0], { itemId: valve.id, quantity: '10' })
    await receive(client, office, lines[1], { itemId: sample.id, quantity: '2' })
    await receive(client, office, lines[2], { itemId: third.id, quantity: '3' })

    await Promise.all([valve.refresh(), sample.refresh(), third.refresh()])
    assert.equal(valve.purchasePrice, '4.7250')
    assert.equal(sample.purchasePrice, '7.0000')
    assert.equal(third.purchasePrice, '3.3333')
    const free = await StockMovement.findByOrFail('itemId', sample.id)
    assert.equal(free.quantity, '2.000')
    assert.isNull(free.unitCost)
    const [line] = await SupplierInvoiceLine.query().where('id', lines[1].id)
    assert.isNull(line.previousPurchasePrice)
  })

  test('another unit: the quantity is given in the Item’s, with a warning; decimals', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { lines } = await invoiceWith(
      office,
      supplierInvoiceXmlWithLines([
        // A box of 10 pieces
        {
          description: 'Guarnizioni',
          quantity: '2.00',
          unit: 'CF',
          unitPrice: '6.00',
          total: '12.00',
        },
        {
          description: 'Tubo multistrato',
          quantity: '12.50',
          unit: 'MT',
          unitPrice: '2.00',
          total: '25.00',
        },
        { description: 'Cavo', quantity: '1.2345', unit: 'm', unitPrice: '10.00', total: '12.35' },
      ])
    )
    const gaskets = await createItem({ unit: 'pz' })
    const pipe = await createItem({ unit: 'm' })
    const cable = await createItem({ unit: 'm' })

    // Received as 20 pieces: 0.60 each, with a warning to check the quantity
    const boxes = await receive(client, office, lines[0], { itemId: gaskets.id, quantity: '20' })
    boxes.assertFlashMessage(
      'warning',
      it('flash.supplierInvoiceLineUnits', { lineUnit: 'CF', unit: 'pz' })
    )
    await gaskets.refresh()
    assert.equal(gaskets.purchasePrice, '0.6000')

    // MT is the Item's m; metres with a decimal comma
    const metres = await receive(client, office, lines[1], { itemId: pipe.id, quantity: '12,5' })
    assert.isUndefined(metres.flashMessage('warning'))
    const [movement] = await StockMovement.query().where('itemId', pipe.id)
    assert.equal(movement.quantity, '12.500')
    await pipe.refresh()
    assert.equal(pipe.purchasePrice, '2.0000')

    // More decimals than stock keeps: refused, nothing received
    const tooFine = await receive(client, office, lines[2], {
      itemId: cable.id,
      quantity: '1,2345',
    })
    assert.deepEqual(tooFine.flashMessage('inputErrorsBag').quantity, [
      it('validator.shared.messages.quantity', { field: 'quantità' }),
    ])
    assert.lengthOf(await StockMovement.query().where('itemId', cable.id), 0)
    const [open] = await SupplierInvoiceLine.query().where('id', lines[2].id)
    assert.isNull(open.outcome)
  })

  test('the resale price never changes; a warning when below the Category’s markup', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { lines } = await invoiceWith(office)
    const category = await createCategory({ markupPercent: '35' })
    // 5.25 × 1.35 = 7.0875: 7.00 is now below it, 8.00 isn't
    const below = await createItem({
      categoryId: category.id,
      purchasePrice: '5',
      resalePrice: '7',
    })
    const fine = await createItem({
      categoryId: category.id,
      purchasePrice: '90',
      resalePrice: '140',
    })

    const warned = await receive(client, office, lines[0], { itemId: below.id, quantity: '10' })
    warned.assertFlashMessage(
      'warning',
      it('flash.supplierInvoiceLineBelowMarkup', { code: below.code, markup: '35' })
    )
    await below.refresh()
    assert.equal(below.resalePrice, '7.0000')
    assert.equal(below.purchasePrice, '5.2500')

    // 97.50 × 1.35 = 131.625: 140 is still above it
    const quiet = await receive(client, office, lines[1], { itemId: fine.id, quantity: '1' })
    assert.isUndefined(quiet.flashMessage('warning'))
  })

  test('a line is never received twice, nor marked once received', async ({ client, assert }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(office)
    const item = await createItem()
    const other = await createItem()

    await receive(client, office, lines[0], { itemId: item.id, quantity: '10' })
    const again = await receive(client, office, lines[0], { itemId: item.id, quantity: '10' })
    again.assertHeader('location', `/supplier-invoices/${invoice.id}`)
    again.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.handled'))
    const elsewhere = await receive(client, office, lines[0], { itemId: other.id, quantity: '10' })
    elsewhere.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.handled'))
    const marked = await markNotStock(client, office, lines[0])
    marked.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.handled'))

    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 1)
    assert.lengthOf(await StockMovement.query().where('itemId', other.id), 0)
    const [line] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.equal(line.outcome, 'received')
    assert.equal(line.itemId, item.id)

    // A line marked not stock isn't received either
    await markNotStock(client, office, lines[1])
    const notStock = await receive(client, office, lines[1], { itemId: item.id, quantity: '1' })
    notStock.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.handled'))
    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 1)

    // Nothing to undo on a line to handle
    const { lines: fresh } = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-2' }))
    const nothing = await undo(client, office, fresh[0])
    nothing.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.notHandled'))
  })

  test('undoing a receipt: an adjustment, and the Item as it was', async ({ client, assert }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(office)
    const wrong = await createItem({ purchasePrice: '4.8' })
    const right = await createItem({ purchasePrice: '5' })

    await receive(client, office, lines[0], { itemId: wrong.id, quantity: '10' })
    await markNotStock(client, office, lines[1])
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')

    const undone = await undo(client, office, lines[0])
    undone.assertHeader('location', `/supplier-invoices/${invoice.id}`)
    undone.assertFlashMessage('success', it('flash.supplierInvoiceLineUndone'))

    // The receipt stays; an adjustment takes it back off stock
    const movements = await StockMovement.query().where('itemId', wrong.id).orderBy('id')
    assert.deepEqual(
      movements.map((movement) => [movement.kind, movement.quantity, movement.reason]),
      [
        ['receipt', '10.000', null],
        ['adjustment', '-10.000', it('ui.supplierInvoices.undoReason', { line: 1 })],
      ]
    )
    assert.equal(movements[1].reference, movements[0].reference)
    assert.equal(movements[1].occurredOn.toISODate(), today())
    const stock = await StockLedger.quantitiesOf(wrong)
    assert.equal(stock.inStock, '0.000')

    // Its purchase price, Supplier and code back as they were
    await wrong.refresh()
    assert.equal(wrong.purchasePrice, '4.8000')
    assert.isNull(wrong.supplierId)
    assert.isNull(wrong.supplierCode)

    // The line is to handle again, and so is the invoice
    const [line] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.deepInclude(line.serialize(), {
      outcome: null,
      itemId: null,
      stockMovementId: null,
      previousPurchasePrice: null,
      setSupplierCode: false,
      handledAt: null,
      handledBy: null,
    })
    await invoice.refresh()
    assert.equal(invoice.status, 'to_handle')
    assert.isNull(invoice.handledAt)

    // Received onto the right Item, it is handled again
    await receive(client, office, lines[0], { itemId: right.id, quantity: '10' })
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')
    await right.refresh()
    assert.equal(right.purchasePrice, '5.2500')

    // Not stock can be undone too: no movement
    await undo(client, office, lines[1])
    const [shipping] = await SupplierInvoiceLine.query().where('id', lines[1].id)
    assert.isNull(shipping.outcome)
    await invoice.refresh()
    assert.equal(invoice.status, 'to_handle')
  })

  test('undoing keeps what changed since: a newer price, another line’s Supplier link', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const first = await invoiceWith(office)
    const second = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-2' }))
    const item = await createItem({ purchasePrice: '4' })
    const priced = await createItem({ purchasePrice: '4' })
    const earlier = DateTime.now().minus({ days: 5 }).toISODate()!

    // Two receipts of the Supplier onto one Item, at 5.25 each: the second is the newer
    await receive(client, office, first.lines[0], {
      itemId: item.id,
      quantity: '10',
      occurredOn: earlier,
    })
    await receive(client, office, second.lines[0], { itemId: item.id, quantity: '10' })

    await undo(client, office, first.lines[0])
    await item.refresh()
    // The price comes from the newer receipt: kept. The other line keeps the Supplier and code
    assert.equal(item.purchasePrice, '5.2500')
    assert.equal(item.supplierId, first.invoice.supplierId)
    assert.equal(item.supplierCode, 'VLV-034')

    // Undoing the second too takes the link back. The code and price stay: the second set
    // neither, and the first's undo had left them (docs/follow-ups.md)
    await undo(client, office, second.lines[0])
    await item.refresh()
    assert.isNull(item.supplierId)
    assert.equal(item.supplierCode, 'VLV-034')
    assert.equal(item.purchasePrice, '5.2500')

    // A price Office edited by hand after the receipt is kept too
    await receive(client, office, first.lines[1], { itemId: priced.id, quantity: '1' })
    await priced.merge({ purchasePrice: '99' }).save()
    await undo(client, office, first.lines[1])
    await priced.refresh()
    assert.equal(priced.purchasePrice, '99.0000')
  })

  test('what can only be marked not stock: credit notes, other currencies, negative lines', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const item = await createItem()
    const archived = await createItem({ archivedAt: DateTime.now() })
    const line = { description: 'Valvola', quantity: '1.00', unitPrice: '5.00', total: '5.00' }

    const credit = await invoiceWith(
      office,
      supplierInvoiceXmlWithLines([line], { documentType: 'TD04' })
    )
    const dollars = await invoiceWith(
      office,
      supplierInvoiceXmlWithLines([line], { number: 'USD-1', currency: 'USD' })
    )
    const discount = await invoiceWith(
      office,
      supplierInvoiceXmlWithLines(
        [line, { description: 'Abbuono', unitPrice: '-1.00', total: '-1.00' }],
        { number: 'NEG-1' }
      )
    )

    for (const [{ invoice, lines }, position, reason] of [
      [credit, 0, 'creditNote'],
      [dollars, 0, 'currency'],
      [discount, 1, 'negativeTotal'],
    ] as const) {
      const response = await receive(client, office, lines[position], {
        itemId: item.id,
        quantity: '1',
      })
      response.assertFlashMessage('error', it(`flash.supplierInvoiceLineRefused.${reason}`))
      const shown = await pageLines(client, office, invoice)
      assert.equal(shown[position].refusal, reason)
    }
    const [positive] = await pageLines(client, office, discount.invoice)
    assert.isNull(positive.refusal)
    // An archived Item is refused
    const refused = await receive(client, office, discount.lines[0], {
      itemId: archived.id,
      quantity: '1',
    })
    refused.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.archivedItem'))
    assert.lengthOf(await StockMovement.all(), 0)

    // Marked not stock, the credit note is handled
    await markNotStock(client, office, credit.lines[0])
    await credit.invoice.refresh()
    assert.equal(credit.invoice.status, 'handled')
  })

  test('descriptionKey() and its SQL agree', async ({ assert }) => {
    for (const description of ['  Raccordi\n e   GUARNIZIONI\t', 'Valvola 3/4" è nichelata']) {
      const row = await db.rawQuery(`SELECT ${DESCRIPTION_KEY_SQL('?::text')} AS key`, [
        description,
      ])
      assert.equal(row.rows[0].key, descriptionKey(description))
    }
  })

  test('Technicians and the Superuser are refused on every line route; Admins use them', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(office)
    const item = await createItem()

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const response of [
        await receive(client, user, lines[0], { itemId: item.id, quantity: '10' }),
        await markNotStock(client, user, lines[0]),
        await undo(client, user, lines[0]),
      ]) {
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    // Nothing changed
    const [line] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.isNull(line.outcome)
    assert.lengthOf(await StockMovement.all(), 0)
    await invoice.refresh()
    assert.equal(invoice.status, 'to_handle')

    // A received line refused an undo by them stays received
    const admin = await createUser('admin')
    const received = await receive(client, admin, lines[0], { itemId: item.id, quantity: '10' })
    received.assertFlashMessage(
      'success',
      it('flash.supplierInvoiceLineReceived', { quantity: '10', unit: 'pz', code: item.code })
    )
    const technician = await createUser('technician')
    const refused = await undo(client, technician, lines[0])
    refused.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    assert.lengthOf(await StockMovement.all(), 1)

    // Admins use every route
    const undone = await undo(client, admin, lines[0])
    undone.assertFlashMessage('success', it('flash.supplierInvoiceLineUndone'))
    const marked = await markNotStock(client, admin, lines[0])
    marked.assertFlashMessage('success', it('flash.supplierInvoiceLineNotStock'))
    const [byAdmin] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.equal(byAdmin.handledBy, admin.id)
  })
})
