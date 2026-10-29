import { test } from '@japa/runner'
import { JOB_STATUSES } from '#shared/jobs'
import { WORK_STATES } from '#shared/charges'
import { formatQuantity, isCommitted, reorderReason, stockQuantities } from '#shared/stock'

test.group('Committed stock', () => {
  test('only planned Charges on Jobs open or in progress commit', ({ assert }) => {
    const committing = WORK_STATES.flatMap((work) =>
      JOB_STATUSES.filter((status) => isCommitted(work, status)).map((status) => [work, status])
    )
    assert.deepEqual(committing, [
      ['planned', 'open'],
      ['planned', 'in_progress'],
    ])
  })

  test('available is in stock less committed', ({ assert }) => {
    assert.deepEqual(
      stockQuantities(
        [{ quantity: '10' }, { quantity: '-2.5' }],
        [
          { quantity: '3', work: 'planned', jobStatus: 'in_progress' },
          { quantity: '1.25', work: 'planned', jobStatus: 'open' },
          { quantity: '4', work: 'done', jobStatus: 'open' },
          { quantity: '5', work: 'not_done', jobStatus: 'open' },
          { quantity: '6', work: 'planned', jobStatus: 'closed' },
          { quantity: '7', work: 'planned', jobStatus: 'cancelled' },
        ]
      ),
      { inStock: '7.500', committed: '4.250', available: '3.250' }
    )
    assert.deepEqual(stockQuantities([], []), {
      inStock: '0.000',
      committed: '0.000',
      available: '0.000',
    })
  })

  test('reorder by what is available', ({ assert }) => {
    assert.equal(reorderReason('-0.001', null), 'negative')
    assert.equal(reorderReason('-1', '5'), 'negative')
    assert.equal(reorderReason('5', '5'), 'low')
    assert.equal(reorderReason('5.001', '5'), null)
    assert.equal(reorderReason('0', null), null)
  })

  test('quantities as people write them', ({ assert }) => {
    assert.equal(formatQuantity('2.500'), '2,5')
    assert.equal(formatQuantity('3.000'), '3')
    assert.equal(formatQuantity('100.000'), '100')
    assert.equal(formatQuantity('-1.500'), '-1,5')
  })
})
