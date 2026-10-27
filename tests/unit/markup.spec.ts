import { test } from '@japa/runner'
import { isBelowMarkup } from '#shared/money'

test.group('Markup check', () => {
  test('flags a resale price below the Category markup', ({ assert }) => {
    assert.isFalse(isBelowMarkup('10', '13.5', '35'))
    assert.isTrue(isBelowMarkup('10', '13.49', '35'))
    assert.isTrue(isBelowMarkup('11', '13.5', '35'))
  })

  test('never flags a price set exactly to the suggestion', ({ assert }) => {
    // 1.2341 x 1.35 = 1.666035, suggested (rounded) as 1.6660
    assert.isFalse(isBelowMarkup('1.2341', '1.666', '35'))
    assert.isFalse(isBelowMarkup('3', '3.9999', '33.33'))
  })
})
