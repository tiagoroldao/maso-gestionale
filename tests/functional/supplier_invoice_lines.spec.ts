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
  form: {
    itemId: number
    quantity: string
    occurredOn?: string
    unitCost?: string
    updatePurchasePrice?: 'true' | 'false'
  }
) {
  return post(client, user, `/supplier-invoice-lines/${line.id}/receipt`, {
    itemId: String(form.itemId),
    quantity: form.quantity,
    occurredOn: form.occurredOn ?? today(),
    ...(form.unitCost !== undefined && { unitCost: form.unitCost }),
    ...(form.updatePurchasePrice && { updatePurchasePrice: form.updatePurchasePrice }),
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
          receipt: { quantity: string; unitCost: string | null; occurredOn: string } | null
          unitCost: string | null
          suggestion: { id: number } | null
          candidate: { id: number; newestCostOn: string | null } | null
          manualReceipts: {
            id: number
            occurredOn: string
            quantity: string
            unitCost: string | null
            reference: string | null
            newerCost: boolean
          }[]
          defaultAmount: string
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
    // The description, spaces and case aside; never an archived Item nor another Supplier's
    await createItem({ description: 'Raccordi e guarnizioni', archivedAt: DateTime.now() })
    await createItem({
      code: 'A-OTHER',
      supplierId: other.id,
      description: 'Raccordi e guarnizioni',
    })
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

    // A later line received onto another Supplier's Item isn't suggested from history either
    const othersItem = await createItem({ code: 'OTHERS', supplierId: other.id })
    const later = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-LATER' }))
    await receive(client, office, later.lines[1], { itemId: othersItem.id, quantity: '1' })
    ;[, fitting] = await pageLines(client, office, invoice)
    assert.equal(fitting.suggestion?.id, earlierItem.id)
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
      receipt: { quantity: '10.000', unitCost: '5.2500', occurredOn: receivedOn },
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

function alreadyReceived(
  client: ApiClient,
  user: User,
  line: SupplierInvoiceLine,
  form: Record<string, string | number>
) {
  return post(
    client,
    user,
    `/supplier-invoice-lines/${line.id}/already-received`,
    Object.fromEntries(Object.entries(form).map(([key, value]) => [key, String(value)]))
  )
}

const spreadDiscounts = (client: ApiClient, user: User, invoice: SupplierInvoice, on: boolean) =>
  client
    .put(`/supplier-invoices/${invoice.id}/spread-discounts`)
    .form({ spreadDiscounts: on ? 'true' : 'false' })
    .header('referer', '/')
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)

/** The invoice page's props, with Items picked for some lines (`pick`, by line id) */
async function invoicePage(
  client: ApiClient,
  user: User,
  invoice: SupplierInvoice,
  pick: Record<number, number> = {}
) {
  const qs = Object.entries(pick)
    .map(([line, item]) => `pick[${line}]=${item}`)
    .join('&')
  const response = await client
    .get(`/supplier-invoices/${invoice.id}${qs ? `?${qs}` : ''}`)
    .withInertia()
    .loginAs(user)
  response.assertInertiaComponent('supplier_invoices/show')
  return response.inertiaProps as {
    invoice: {
      spreadDiscounts: boolean
      discount: string
      spreadable: boolean
      lines: Awaited<ReturnType<typeof pageLines>>
    }
  }
}

const daysAgo = (days: number) => DateTime.now().minus({ days })

test.group('Supplier Invoice lines: already received, and the costs confirmed (#210)', (group) => {
  group.each.setup(async () => {
    await completeCompany()
  })
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('already received onto a receipt by hand: no movement, its cost; undone as it was', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const item = await createItem({ supplierCode: 'VLV-034', purchasePrice: '4.8' })
    // Received by hand from the delivery note, without a cost
    const byHand = await StockLedger.receive(item, {
      quantity: '10',
      occurredOn: daysAgo(3),
      reference: 'DDT 812',
    })
    const { invoice, lines } = await invoiceWith(office)

    // The suggested Item's receipt by hand is offered, and hinted at
    let [valve] = await pageLines(client, office, invoice)
    assert.equal(valve.candidate?.id, item.id)
    assert.isNull(valve.candidate?.newestCostOn)
    assert.deepEqual(valve.manualReceipts, [
      {
        id: byHand.id,
        occurredOn: daysAgo(3).toISODate()!,
        quantity: '10.000',
        unitCost: null,
        reference: 'DDT 812',
        newerCost: false,
      },
    ])
    assert.equal(valve.defaultAmount, '52.5')

    const marked = await alreadyReceived(client, office, lines[0], {
      itemId: item.id,
      receiptId: byHand.id,
      quantity: '10',
    })
    marked.assertHeader('location', `/supplier-invoices/${invoice.id}`)
    marked.assertFlashMessage(
      'success',
      it('flash.supplierInvoiceLineAlreadyReceived', { code: item.code })
    )

    // Stock doesn't move; the receipt takes the invoice's cost, and so does the price
    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 1)
    const stock = await StockLedger.quantitiesOf(item)
    assert.equal(stock.inStock, '10.000')
    await Promise.all([byHand.refresh(), item.refresh()])
    assert.equal(byHand.unitCost, '5.2500')
    assert.equal(item.purchasePrice, '5.2500')
    assert.equal(item.supplierId, invoice.supplierId)
    const [line] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.deepInclude(line.serialize(), {
      outcome: 'already_received',
      itemId: item.id,
      stockMovementId: byHand.id,
      unitCost: '5.2500',
      setReceiptCost: true,
      previousPurchasePrice: '4.8000',
      setSupplierCode: false,
      handledBy: office.id,
    })
    ;[valve] = await pageLines(client, office, invoice)
    assert.deepInclude(valve, {
      outcome: 'already_received',
      unitCost: '5.2500',
      receipt: { quantity: '10.000', unitCost: '5.2500', occurredOn: daysAgo(3).toISODate()! },
    })
    // Linked, it is no longer offered to another line
    const other = await invoicePage(client, office, invoice, { [lines[1].id]: item.id })
    assert.equal(other.invoice.lines[1].candidate?.id, item.id)
    assert.deepEqual(other.invoice.lines[1].manualReceipts, [])

    // Undone: no adjustment, the receipt without a cost again, the Item as it was
    const undone = await undo(client, office, lines[0])
    undone.assertFlashMessage('success', it('flash.supplierInvoiceLineUndone'))
    assert.lengthOf(await StockMovement.query().where('itemId', item.id), 1)
    await Promise.all([byHand.refresh(), item.refresh(), line.refresh()])
    assert.isNull(byHand.unitCost)
    assert.equal(item.purchasePrice, '4.8000')
    assert.isNull(item.supplierId)
    assert.equal(item.supplierCode, 'VLV-034')
    assert.deepInclude(line.serialize(), {
      outcome: null,
      itemId: null,
      stockMovementId: null,
      unitCost: null,
      setReceiptCost: false,
      previousPurchasePrice: null,
    })
    ;[valve] = await pageLines(client, office, invoice)
    assert.deepEqual(
      valve.manualReceipts.map((receipt) => receipt.id),
      [byHand.id]
    )
  })

  test('already received: a receipt’s own cost stays; without a receipt; what can’t be linked', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const valve = await createItem({ purchasePrice: '4' })
    const fittings = await createItem({ purchasePrice: '90' })
    const other = await createItem()
    const costed = await StockLedger.receive(valve, {
      quantity: '10',
      unitCost: '6',
      occurredOn: daysAgo(2),
    })
    const { invoice, lines } = await invoiceWith(office)

    // A receipt with its own cost keeps it; the line keeps Office's; the price stays if asked
    await alreadyReceived(client, office, lines[0], {
      itemId: valve.id,
      receiptId: costed.id,
      quantity: '10',
      unitCost: '5,1',
      updatePurchasePrice: 'false',
    })
    await Promise.all([costed.refresh(), valve.refresh()])
    assert.equal(costed.unitCost, '6.0000')
    assert.equal(valve.purchasePrice, '6.0000')
    const [first] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.deepInclude(first.serialize(), {
      unitCost: '5.1000',
      setReceiptCost: false,
      previousPurchasePrice: null,
    })

    // Without a receipt: the line's own amount, and the price follows (no newer cost)
    await alreadyReceived(client, office, lines[1], { itemId: fittings.id, quantity: '1' })
    await fittings.refresh()
    assert.equal(fittings.purchasePrice, '97.5000')
    const [second] = await SupplierInvoiceLine.query().where('id', lines[1].id)
    assert.isNull(second.stockMovementId)
    assert.equal(second.unitCost, '97.5000')
    await invoice.refresh()
    assert.equal(invoice.status, 'handled')
    assert.lengthOf(await StockMovement.query().where('itemId', fittings.id), 0)

    // What can't be linked: another Item's receipt, one from a line (even undone), one linked
    const fresh = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-2' }))
    const othersReceipt = await StockLedger.receive(other, {
      quantity: '1',
      occurredOn: daysAgo(1),
    })
    const third = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-3' }))
    await receive(client, office, third.lines[0], { itemId: valve.id, quantity: '10' })
    await undo(client, office, third.lines[0])
    const [fromLine] = await StockMovement.query()
      .where('itemId', valve.id)
      .where('kind', 'receipt')
      .whereNotNull('supplierInvoiceLineId')
    for (const receiptId of [othersReceipt.id, fromLine.id, costed.id]) {
      const refused = await alreadyReceived(client, office, fresh.lines[0], {
        itemId: valve.id,
        receiptId,
        quantity: '10',
      })
      refused.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.receiptNotLinkable'))
    }
    const [untouched] = await SupplierInvoiceLine.query().where('id', fresh.lines[0].id)
    assert.isNull(untouched.outcome)

    // Lines that can't be received can't be already received either
    const credit = await invoiceWith(
      office,
      supplierInvoiceXmlWithLines(
        [{ description: 'Valvola', quantity: '1.00', unitPrice: '5.00', total: '5.00' }],
        { number: 'NC-1', documentType: 'TD04' }
      )
    )
    const creditRefused = await alreadyReceived(client, office, credit.lines[0], {
      itemId: valve.id,
      quantity: '1',
    })
    creditRefused.assertFlashMessage('error', it('flash.supplierInvoiceLineRefused.creditNote'))
  })

  test('the hint: receipts by hand since the delivery notes, else the last 30 days', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const item = await createItem({ supplierCode: 'VLV-034' })
    const picked = await createItem()
    const old = await StockLedger.receive(item, { quantity: '2', occurredOn: daysAgo(40) })
    const recent = await StockLedger.receive(item, { quantity: '5', occurredOn: daysAgo(10) })
    const pickedReceipt = await StockLedger.receive(picked, {
      quantity: '1',
      occurredOn: daysAgo(1),
    })
    // Received from another invoice's line: not by hand
    const earlier = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-0' }))
    await receive(client, office, earlier.lines[0], {
      itemId: item.id,
      quantity: '1',
      occurredOn: daysAgo(5).toISODate()!,
    })

    // No delivery notes: the last 30 days
    const plain = await invoiceWith(office)
    const [line] = await pageLines(client, office, plain.invoice)
    assert.deepEqual(
      line.manualReceipts.map((receipt) => receipt.id),
      [recent.id]
    )
    // The newer receipt from the line has a cost
    assert.isTrue(line.manualReceipts[0].newerCost)
    assert.equal(line.candidate?.newestCostOn, daysAgo(5).toISODate())

    // Since the earliest delivery note the invoice cites
    const cited = await invoiceWith(
      office,
      supplierInvoiceXml({
        number: 'FV-DDT',
        deliveryNotes: [
          { number: '7', date: daysAgo(20).toISODate()! },
          { number: '6', date: daysAgo(45).toISODate()! },
        ],
      })
    )
    const [citedLine] = await pageLines(client, office, cited.invoice)
    assert.deepEqual(
      citedLine.manualReceipts.map((receipt) => receipt.id),
      [recent.id, old.id]
    )

    // An Item Office picks comes with its own
    const withPick = await invoicePage(client, office, plain.invoice, {
      [plain.lines[0].id]: picked.id,
    })
    assert.equal(withPick.invoice.lines[0].candidate?.id, picked.id)
    assert.equal(withPick.invoice.lines[0].suggestion?.id, item.id)
    assert.deepEqual(
      withPick.invoice.lines[0].manualReceipts.map((receipt) => receipt.id),
      [pickedReceipt.id]
    )
  })

  test('spreading the invoice’s discounts: off by default, the default costs follow', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(
      office,
      supplierInvoiceXmlWithLines(
        [
          { description: 'Valvola', quantity: '10.00', unitPrice: '10.00', total: '100.00' },
          { description: 'Raccordi', quantity: '1.00', unitPrice: '50.00', total: '50.00' },
          { description: 'Trasporto', quantity: '1.00', unitPrice: '12.00', total: '12.00' },
          { description: 'Abbuono', unitPrice: '-10.00', total: '-10.00' },
        ],
        // 5% of the lines' 152.00
        { discounts: [{ type: 'SC', percent: '5.00' }] }
      )
    )
    const valve = await createItem()
    const fittings = await createItem()
    await markNotStock(client, office, lines[2])
    await markNotStock(client, office, lines[3])

    let shown = await invoicePage(client, office, invoice)
    assert.deepInclude(shown.invoice, {
      spreadDiscounts: false,
      discount: '17.60',
      spreadable: true,
    })
    assert.deepEqual(
      shown.invoice.lines.map((line) => line.defaultAmount),
      ['100', '50', '12', '-10']
    )

    // On: 17.60 over 100 and 50 is 11.733… and 5.866…: 11.73 and 5.87, adding up exactly
    const on = await spreadDiscounts(client, office, invoice, true)
    on.assertHeader('location', `/supplier-invoices/${invoice.id}`)
    on.assertFlashMessage('success', it('flash.supplierInvoiceSpread'))
    shown = await invoicePage(client, office, invoice)
    assert.isTrue(shown.invoice.spreadDiscounts)
    assert.deepEqual(
      shown.invoice.lines.map((line) => line.defaultAmount),
      ['88.27', '44.13', '12', '-10']
    )

    // Received at the default: the spread cost; Office's own cost when given
    await receive(client, office, lines[0], { itemId: valve.id, quantity: '10' })
    await receive(client, office, lines[1], {
      itemId: fittings.id,
      quantity: '1',
      unitCost: '44',
    })
    const [valveReceipt] = await StockMovement.query().where('itemId', valve.id)
    const [fittingsReceipt] = await StockMovement.query().where('itemId', fittings.id)
    assert.equal(valveReceipt.unitCost, '8.8270')
    assert.equal(fittingsReceipt.unitCost, '44.0000')

    // Off again: the default costs are the lines' own; what was recorded stays
    const off = await spreadDiscounts(client, office, invoice, false)
    off.assertFlashMessage('success', it('flash.supplierInvoiceNotSpread'))
    await invoice.refresh()
    assert.isFalse(invoice.spreadDiscounts)
    await valveReceipt.refresh()
    assert.equal(valveReceipt.unitCost, '8.8270')
  })

  test('the cost Office confirms, and the purchase price switch', async ({ client, assert }) => {
    const office = await createUser('office')
    const newer = await createItem({ purchasePrice: '4' })
    const forced = await createItem({ purchasePrice: '4' })
    const kept = await createItem({ purchasePrice: '4' })
    const category = await createCategory({ markupPercent: '35' })
    const cheap = await createItem({
      categoryId: category.id,
      purchasePrice: '4',
      resalePrice: '6',
    })
    for (const item of [newer, forced]) {
      await StockLedger.receive(item, { quantity: '1', unitCost: '7', occurredOn: daysAgo(1) })
    }
    const first = await invoiceWith(office)
    const second = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-2' }))

    // A newer receipt has a cost: the page knows, and by default the price stays
    const [line] = await pageLines(client, office, first.invoice)
    assert.isNull(line.candidate)
    const picked = await invoicePage(client, office, first.invoice, {
      [first.lines[0].id]: newer.id,
    })
    assert.equal(picked.invoice.lines[0].candidate?.newestCostOn, daysAgo(1).toISODate())
    await receive(client, office, first.lines[0], {
      itemId: newer.id,
      quantity: '10',
      occurredOn: daysAgo(5).toISODate()!,
      unitCost: '5,5',
    })
    await newer.refresh()
    assert.equal(newer.purchasePrice, '7.0000')
    const [recorded] = await StockMovement.query()
      .where('itemId', newer.id)
      .where('supplierInvoiceLineId', first.lines[0].id)
    assert.equal(recorded.unitCost, '5.5000')

    // Switched on, it becomes the price all the same
    await receive(client, office, second.lines[0], {
      itemId: forced.id,
      quantity: '10',
      occurredOn: daysAgo(5).toISODate()!,
      updatePurchasePrice: 'true',
    })
    await forced.refresh()
    assert.equal(forced.purchasePrice, '5.2500')

    // Switched off, it doesn't, even as the newest
    await receive(client, office, first.lines[1], {
      itemId: kept.id,
      quantity: '1',
      updatePurchasePrice: 'false',
    })
    await kept.refresh()
    assert.equal(kept.purchasePrice, '4.0000')
    const [keptLine] = await SupplierInvoiceLine.query().where('id', first.lines[1].id)
    assert.isNull(keptLine.previousPurchasePrice)

    // The markup warning applies to a line already received too: 97.50 × 1.35 > 6
    const warned = await alreadyReceived(client, office, second.lines[1], {
      itemId: cheap.id,
      quantity: '1',
    })
    warned.assertFlashMessage(
      'warning',
      it('flash.supplierInvoiceLineBelowMarkup', { code: cheap.code, markup: '35' })
    )
    await cheap.refresh()
    assert.equal(cheap.purchasePrice, '97.5000')
    assert.equal(cheap.resalePrice, '6.0000')

    // A cost of zero records none; one that isn't an amount is refused
    const third = await invoiceWith(office, supplierInvoiceXml({ number: 'FV-3' }))
    const free = await receive(client, office, third.lines[0], {
      itemId: kept.id,
      quantity: '10',
      unitCost: '0',
    })
    free.assertFlashMessage(
      'success',
      it('flash.supplierInvoiceLineReceived', { quantity: '10', unit: 'pz', code: kept.code })
    )
    const [freeReceipt] = await StockMovement.query().where(
      'supplierInvoiceLineId',
      third.lines[0].id
    )
    assert.isNull(freeReceipt.unitCost)
    const badCost = await receive(client, office, third.lines[1], {
      itemId: kept.id,
      quantity: '1',
      unitCost: '1.234,5',
    })
    assert.deepEqual(badCost.flashMessage('inputErrorsBag').unitCost, [
      it('validator.shared.messages.amount', { field: 'costo unitario' }),
    ])
  })

  test('Technicians and the Superuser are refused already received and the spread; Admins use them', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { invoice, lines } = await invoiceWith(office)
    const item = await createItem()

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const response of [
        await alreadyReceived(client, user, lines[0], { itemId: item.id, quantity: '10' }),
        await spreadDiscounts(client, user, invoice, true),
      ]) {
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    const [line] = await SupplierInvoiceLine.query().where('id', lines[0].id)
    assert.isNull(line.outcome)
    await invoice.refresh()
    assert.isFalse(invoice.spreadDiscounts)

    const admin = await createUser('admin')
    const marked = await alreadyReceived(client, admin, lines[0], {
      itemId: item.id,
      quantity: '10',
    })
    marked.assertFlashMessage(
      'success',
      it('flash.supplierInvoiceLineAlreadyReceived', { code: item.code })
    )
    const spread = await spreadDiscounts(client, admin, invoice, true)
    spread.assertFlashMessage('success', it('flash.supplierInvoiceSpread'))
    await invoice.refresh()
    assert.isTrue(invoice.spreadDiscounts)
  })
})
