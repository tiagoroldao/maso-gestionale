import { test } from '@japa/runner'
import { keptVatTreatment, lineKindOf, needsSignificantGoodSplit, vatLabel } from '#shared/vat'

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

test.group('VAT treatment of a saved line', () => {
  test('kept while its code is unchanged; the code read again otherwise', ({ assert }) => {
    const saved = { vatCodeId: 1, vatRate: '22.00', natura: null }
    assert.strictEqual(keptVatTreatment(saved, 1), saved)
    assert.isNull(keptVatTreatment(saved, 2))
    assert.isNull(keptVatTreatment(null, 1))
  })
})

test.group('VAT labels', () => {
  test('the Natura code, or the rate without trailing zeros', ({ assert }) => {
    assert.equal(vatLabel({ vatRate: '22.00', natura: null }), '22%')
    assert.equal(vatLabel({ vatRate: '5.50', natura: null }), '5,5%')
    assert.equal(vatLabel({ vatRate: '0.00', natura: 'N6.7' }), 'N6.7')
  })
})
