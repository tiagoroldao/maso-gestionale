import { test } from '@japa/runner'
import {
  combineCharges,
  consumableFolds,
  workPeriod,
  type CombinableCharge,
} from '#shared/combined_lines'

const hours = (id: string, rate: number, quantity: string, price = '40'): Charge => ({
  id,
  kind: 'labour',
  labourRateId: rate,
  itemId: null,
  groupable: false,
  unitPrice: price,
  vatCodeId: 1,
  billQuantity: quantity,
})
const item = (
  id: string,
  itemId: number,
  groupable: boolean,
  quantity = '1',
  vatCodeId = 1
): Charge => ({
  id,
  kind: 'item',
  labourRateId: null,
  itemId,
  groupable,
  unitPrice: '10',
  vatCodeId,
  billQuantity: quantity,
})
type Charge = CombinableCharge & { id: string }

const ids = (lines: { charges: Charge[] }[]) => lines.map((line) => line.charges.map((c) => c.id))

test.group('combineCharges', () => {
  test('without combining, one line per Charge in the order given', ({ assert }) => {
    const charges = [hours('a', 1, '2'), item('b', 7, true), hours('c', 1, '1')]
    assert.deepEqual(ids(combineCharges(charges, { combine: false })), [['a'], ['b'], ['c']])
  })

  test('hours of one rate and price share a line, quantities added up', ({ assert }) => {
    const lines = combineCharges([hours('a', 1, '2.5'), hours('b', 1, '1.25')], { combine: true })
    assert.deepEqual(ids(lines), [['a', 'b']])
    assert.equal(lines[0].quantity, '3.750')
  })

  test('another price, rate or VAT Code is another line, next to its kind', ({ assert }) => {
    const lines = combineCharges(
      [
        hours('a', 1, '1'),
        item('b', 7, true),
        hours('c', 2, '1'),
        hours('d', 1, '1', '45'),
        hours('e', 1, '1', '40.0000'),
        item('f', 7, true, '1', 2),
      ],
      { combine: true }
    )
    assert.deepEqual(ids(lines), [['a', 'e'], ['d'], ['b'], ['f'], ['c']])
  })

  test('Items not Groupable and other costs keep a line each, alike ones together', ({
    assert,
  }) => {
    const other = (id: string): Charge => ({
      ...hours(id, 0, '1'),
      kind: 'other',
      labourRateId: null,
    })
    const lines = combineCharges(
      [item('a', 9, false), item('b', 7, true), other('c'), item('d', 9, false), other('e')],
      { combine: true }
    )
    assert.deepEqual(ids(lines), [['a'], ['d'], ['b'], ['c'], ['e']])
  })
})

test.group('workPeriod', () => {
  test('counts Visits and spans their days; the Job itself has none', ({ assert }) => {
    assert.deepEqual(
      workPeriod([
        { visitId: 2, day: '2026-11-28' },
        { visitId: 1, day: '2026-11-03' },
        { visitId: 1, day: '2026-11-03' },
        { visitId: null, day: null },
      ]),
      { visits: 2, from: '2026-11-03', to: '2026-11-28' }
    )
    assert.isNull(workPeriod([{ visitId: null, day: null }]))
  })
})

test.group('consumableFolds', () => {
  test('folds Groupable lines by VAT treatment, skipping incomplete ones', ({ assert }) => {
    const folds = consumableFolds([
      { groupable: true, vatKey: '22', amount: '10.00' },
      { groupable: false, vatKey: '22', amount: '99.00' },
      { groupable: true, vatKey: '10', amount: '5.00' },
      { groupable: true, vatKey: '22', amount: '2.50' },
      { groupable: true, vatKey: '4', amount: '1.00' },
      { groupable: true, vatKey: '4', amount: null },
    ])
    assert.deepEqual(folds, [
      { indices: [0, 3], amount: '12.50' },
      { indices: [2], amount: '5.00' },
    ])
  })
})
