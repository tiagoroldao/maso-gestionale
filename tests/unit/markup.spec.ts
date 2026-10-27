import { test } from '@japa/runner'
import { isBelowMarkup } from '#shared/money'

test.group('Markup check', () => {
  test('flags a resale price below the Category markup', ({ assert }) => {
    assert.isFalse(isBelowMarkup('10', '13.5', '35'))
    assert.isTrue(isBelowMarkup('10', '13.49', '35'))
    assert.isTrue(isBelowMarkup('11', '13.5', '35'))
  })
})
