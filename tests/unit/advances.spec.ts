import { test } from '@japa/runner'
import { advanceLeft, advanceState, deductionRows } from '#shared/advances'

const rows = [
  { vatRate: '22.00', natura: null, taxable: '100.00', vat: '22.00' },
  { vatRate: '10.00', natura: null, taxable: '100.00', vat: '10.00' },
]

test.group('Advance deductions', () => {
  test('an advance is not, partly or fully deducted', ({ assert }) => {
    assert.equal(advanceState('232.00', '0'), 'not_deducted')
    assert.equal(advanceState('232.00', '116.00'), 'partly_deducted')
    assert.equal(advanceState('232.00', '232.00'), 'fully_deducted')
    assert.equal(advanceLeft('232.00', '116.00'), '116.00')
    assert.equal(advanceLeft('232.00', '240.00'), '0.00')
  })

  test('what its Credit Notes credit counts as taken back (ADR 0014)', ({ assert }) => {
    assert.equal(advanceState('232.00', '0', '100.00'), 'partly_deducted')
    assert.equal(advanceState('232.00', '132.00', '100.00'), 'fully_deducted')
    assert.equal(advanceState('232.00', '0', '232.00'), 'fully_deducted')
    assert.equal(advanceLeft('232.00', '116.00', '16.00'), '100.00')
    assert.equal(advanceLeft('232.00', '116.00', '116.00'), '0.00')
  })

  test('a part is split over the VAT rows, their VAT taken out', ({ assert }) => {
    assert.deepEqual(
      deductionRows(rows, '116.00', '232.00').map((row) => row.taxable),
      ['50.00', '50.00']
    )
    assert.deepEqual(
      deductionRows(rows, '10.00', '232.00').map((row) => row.taxable),
      ['4.31', '4.31']
    )
  })

  test('a part never takes back more than its row has left', ({ assert }) => {
    const taken = [
      { vatRate: '22.00', natura: null, taxable: '99.99' },
      { vatRate: '10.00', natura: null, taxable: '0.00' },
    ]
    assert.deepEqual(
      deductionRows(rows, '1.00', '120.00', taken).map((row) => row.taxable),
      ['0.01', '0.43']
    )
  })

  test('the rest takes back exactly what each row has left', ({ assert }) => {
    const taken = [
      { vatRate: '22.00', natura: null, taxable: '4.31' },
      { vatRate: '10.00', natura: null, taxable: '4.31' },
    ]
    assert.deepEqual(
      deductionRows(rows, '222.00', '222.00', taken).map((row) => row.taxable),
      ['95.69', '95.69']
    )
  })

  test('a row taken back beyond its taxable has nothing left, never a negative amount', ({
    assert,
  }) => {
    // The 10% row was corrected down to 100 after 120 was taken back of it
    const taken = [
      { vatRate: '22.00', natura: null, taxable: '50.00' },
      { vatRate: '10.00', natura: null, taxable: '120.00' },
    ]
    assert.deepEqual(
      deductionRows(rows, '61.00', '61.00', taken).map((row) => row.taxable),
      ['50.00', '0.00']
    )
    assert.deepEqual(
      deductionRows(rows, '30.00', '61.00', taken).map((row) => row.taxable),
      ['12.93', '0.00']
    )
  })
})
