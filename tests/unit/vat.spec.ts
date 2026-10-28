import { test } from '@japa/runner'
import { lineKindOf, needsSignificantGoodSplit } from '#shared/vat'

test.group('VAT line kinds', () => {
  test('a line is labour unless it bills an Item', ({ assert }) => {
    assert.equal(lineKindOf(null), 'labour')
    assert.equal(lineKindOf(undefined), 'labour')
    assert.equal(lineKindOf({ significantGood: false }), 'material')
    assert.equal(lineKindOf({ significantGood: true }), 'significant_good')
  })

  test('only a significant good at the 10% rate needs the split', ({ assert }) => {
    const reduced = { rate: '10.00', natura: null }
    assert.isTrue(needsSignificantGoodSplit(reduced, true))
    assert.isFalse(needsSignificantGoodSplit(reduced, false))
    assert.isFalse(needsSignificantGoodSplit({ rate: '22.00', natura: null }, true))
    assert.isFalse(needsSignificantGoodSplit({ rate: '0.00', natura: 'N6.7' }, true))
  })
})
