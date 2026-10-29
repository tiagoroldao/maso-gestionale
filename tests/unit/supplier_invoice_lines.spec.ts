import { test } from '@japa/runner'
import {
  descriptionKey,
  lineReceiptRefusal,
  receiptUnitCost,
  unitsDiffer,
} from '#shared/supplier_invoices'

test.group('Supplier Invoice lines', () => {
  test('the unit cost is the line amount over the quantity received', ({ assert }) => {
    assert.equal(receiptUnitCost('52.50000000', '10.000'), '5.2500')
    // A box of 10 received as pieces
    assert.equal(receiptUnitCost('12.00', '20'), '0.6000')
    // Half-up to 4 decimals
    assert.equal(receiptUnitCost('10.00', '3'), '3.3333')
    assert.equal(receiptUnitCost('0.05', '8'), '0.0063')
    // Free goods leave the purchase price alone
    assert.isNull(receiptUnitCost('0.00000000', '2'))
  })

  test('units differ unless written alike', ({ assert }) => {
    assert.isFalse(unitsDiffer('PZ', 'pz'))
    assert.isFalse(unitsDiffer('Nr.', 'pz'))
    assert.isFalse(unitsDiffer('MT', 'm'))
    assert.isFalse(unitsDiffer('lt', 'l'))
    assert.isFalse(unitsDiffer(null, 'm'))
    assert.isFalse(unitsDiffer(' ', 'm'))
    assert.isTrue(unitsDiffer('CF', 'pz'))
    assert.isTrue(unitsDiffer('KG', 'pz'))
    assert.isTrue(unitsDiffer('M', 'pz'))
  })

  test('which lines can only be marked not stock', ({ assert }) => {
    const invoice = { documentType: 'TD01', currency: 'EUR' }
    assert.isNull(lineReceiptRefusal(invoice, { total: '10.00' }))
    assert.isNull(lineReceiptRefusal(invoice, { total: '0.00' }))
    assert.equal(lineReceiptRefusal(invoice, { total: '-1.00' }), 'negativeTotal')
    assert.equal(
      lineReceiptRefusal({ ...invoice, documentType: 'TD04' }, { total: '10.00' }),
      'creditNote'
    )
    assert.equal(
      lineReceiptRefusal({ ...invoice, currency: 'USD' }, { total: '10.00' }),
      'currency'
    )
  })

  test('descriptions compare without case or extra spaces', ({ assert }) => {
    assert.equal(descriptionKey('  Raccordi\n e   GUARNIZIONI '), 'raccordi e guarnizioni')
  })
})
