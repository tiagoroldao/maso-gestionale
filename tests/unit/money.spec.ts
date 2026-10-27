import { test } from '@japa/runner'
import {
  amountForInput,
  lineTotal,
  markupPercent,
  parseAmount,
  suggestedResalePrice,
  sumAmounts,
} from '#shared/money'

test.group('Money', () => {
  test('parses {$self}')
    .with([
      ['12,50', '12.5'],
      ['12.50', '12.5'],
      [' 7 ', '7'],
      ['0,0345', '0.0345'],
    ])
    .run(({ assert }, [input, expected]) => {
      assert.equal(parseAmount(input)?.toString(), expected)
    })

  test('rejects {$self}')
    .with(['1.234,56', '12,5,0', 'abc', '', '1e3'])
    .run(({ assert }, input) => assert.isNull(parseAmount(input)))

  test('suggests the resale price from the markup, to unit-price precision', ({ assert }) => {
    assert.equal(suggestedResalePrice('10', '35'), '13.5000')
    assert.equal(suggestedResalePrice('0.0345', '100'), '0.0690')
    assert.equal(suggestedResalePrice('0.12345', '0'), '0.1235')
  })

  test('computes the markup of a resale price', ({ assert }) => {
    assert.equal(markupPercent('10', '13.5'), '35.00')
    assert.isNull(markupPercent('0', '5'))
  })

  test('shows stored amounts as they would be typed', ({ assert }) => {
    assert.equal(amountForInput('12.5000'), '12,50')
    assert.equal(amountForInput('0.1250'), '0,125')
    assert.equal(amountForInput('7'), '7,00')
  })

  test('line totals round half-up to the cent', ({ assert }) => {
    assert.equal(lineTotal('3', '1.2345'), '3.70')
    assert.equal(lineTotal('2.5', '0.0345'), '0.09')
    assert.equal(lineTotal('1', '0.005'), '0.01')
    assert.equal(lineTotal('1.333', '3'), '4.00')
  })

  test('sums amounts exactly', ({ assert }) => {
    assert.equal(sumAmounts(['0.10', '0.20']), '0.30')
    assert.equal(sumAmounts([]), '0.00')
  })
})
