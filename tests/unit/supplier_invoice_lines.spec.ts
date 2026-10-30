import Big from 'big.js'
import { test } from '@japa/runner'
import {
  defaultLineAmounts,
  descriptionKey,
  invoiceDiscount,
  lineReceiptRefusal,
  newerCostExists,
  nextPayment,
  receiptUnitCost,
  unitsDiffer,
} from '#shared/supplier_invoices'
import { sumAmounts } from '#shared/money'

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

  test('the invoice discount: negative lines and document discounts, less surcharges', ({
    assert,
  }) => {
    const lines = [{ total: '100.00' }, { total: '50.00' }, { total: '-10.00' }]
    // The negative line alone
    assert.equal(invoiceDiscount([], lines), '10.00')
    // 10% of the lines' total (140.00), an amount, less a surcharge
    assert.equal(
      invoiceDiscount(
        [
          { type: 'SC', percent: '10', amount: null },
          { type: 'SC', percent: null, amount: '2.5' },
          { type: 'MG', percent: '50', amount: '1' },
        ],
        lines
      ),
      '25.50'
    )
    // Percentages half-up to the cent
    assert.equal(
      invoiceDiscount([{ type: 'SC', percent: '3.5', amount: null }], [{ total: '0.30' }]),
      '0.01'
    )
    // Surcharges outweighing the discount
    assert.equal(
      invoiceDiscount([{ type: 'MG', percent: null, amount: '4' }], [{ total: '10' }]),
      '-4.00'
    )
  })

  test('default amounts: the discount spread in proportion, the parts adding up exactly', ({
    assert,
  }) => {
    const invoice = { documentType: 'TD01', currency: 'EUR', spread: true }
    const lines = [
      { id: 1, total: '33.33', outcome: null },
      { id: 2, total: '33.33', outcome: null },
      { id: 3, total: '33.34', outcome: 'received' as const },
      // Shipping: takes no part
      { id: 4, total: '12.00', outcome: 'not_stock' as const },
      // The discount itself, and a free line
      { id: 5, total: '-10.00', outcome: null },
      { id: 6, total: '0.00', outcome: null },
    ]
    const spread = defaultLineAmounts(invoice, [], lines)
    assert.equal(spread.discount, '10.00')
    assert.isTrue(spread.spreadable)
    // 3.333, 3.333, 3.334: the leftover cent goes to the largest remainder
    assert.deepEqual(Object.fromEntries(spread.amounts), {
      1: '30',
      2: '30',
      3: '30',
      4: '12',
      5: '-10',
      6: '0',
    })
    const parts = [1, 2, 3].map((id) =>
      new Big(lines[id - 1].total).minus(spread.amounts.get(id)!).toFixed(2)
    )
    assert.equal(sumAmounts(parts), '10.00')

    // Uneven: 7.00 over 3 equal lines is 2.34 + 2.33 + 2.33
    const uneven = defaultLineAmounts(
      invoice,
      [{ type: 'SC', percent: null, amount: '7' }],
      [
        { id: 1, total: '10', outcome: null },
        { id: 2, total: '10', outcome: null },
        { id: 3, total: '10', outcome: null },
      ]
    )
    assert.deepEqual([...uneven.amounts.values()], ['7.66', '7.67', '7.67'])

    // Off: each line's own amount
    const off = defaultLineAmounts({ ...invoice, spread: false }, [], lines)
    assert.equal(off.amounts.get(1), '33.33')
    assert.equal(off.discount, '10.00')
  })

  test('nothing is spread when no line can take it or it is more than they are', ({ assert }) => {
    const invoice = { documentType: 'TD01', currency: 'EUR', spread: true }
    const tooMuch = defaultLineAmounts(
      invoice,
      [{ type: 'SC', percent: null, amount: '30' }],
      [{ id: 1, total: '20', outcome: null }]
    )
    assert.isFalse(tooMuch.spreadable)
    assert.equal(tooMuch.amounts.get(1), '20')
    // A credit note's lines can't be received: nothing to spread over
    const credit = defaultLineAmounts(
      { ...invoice, documentType: 'TD04' },
      [{ type: 'SC', percent: null, amount: '1' }],
      [{ id: 1, total: '20', outcome: null }]
    )
    assert.isFalse(credit.spreadable)
  })

  test('a newer cost exists when the newest receipt with one is dated after', ({ assert }) => {
    assert.isFalse(newerCostExists(null, '2026-10-15'))
    assert.isFalse(newerCostExists('2026-10-15', '2026-10-15'))
    assert.isFalse(newerCostExists('2026-10-14', '2026-10-15'))
    assert.isTrue(newerCostExists('2026-10-16', '2026-10-15'))
  })

  test('the payment due next: the earliest from today, else the earliest past one', ({
    assert,
  }) => {
    const due = (...dates: (string | null)[]) => dates.map((dueOn, index) => ({ dueOn, index }))
    assert.equal(nextPayment(due('2026-12-31', '2026-10-01', '2026-11-30'), '2026-10-30')?.index, 2)
    assert.equal(nextPayment(due('2026-10-30', '2026-11-30'), '2026-10-30')?.index, 0)
    assert.equal(nextPayment(due('2026-09-30', '2026-08-31'), '2026-10-30')?.index, 1)
    assert.equal(nextPayment(due(null), '2026-10-30')?.index, 0)
    assert.isNull(nextPayment(due(), '2026-10-30'))
  })
})
