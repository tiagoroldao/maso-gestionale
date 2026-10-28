import { test } from '@japa/runner'
import { isSettled, overpaidBy, owed, paymentStatus } from '#shared/payment_status'

const due = '2026-11-30'
const status = (paid: string, today: string, credited = '0') =>
  paymentStatus({ total: '100.00', credited, paid, dueOn: due, today })
const amounts = (paid: string, credited = '0') => ({ total: '100.00', credited, paid })

test.group('Payment status', () => {
  test('is worked out from what was paid and the due date', ({ assert }) => {
    assert.equal(status('0', '2026-11-01'), 'unpaid')
    assert.equal(status('40', '2026-11-01'), 'partly_paid')
    assert.equal(status('100', '2026-11-01'), 'paid')
    // Due today isn't overdue yet; the day after is, paid in part or not
    assert.equal(status('0', '2026-11-30'), 'unpaid')
    assert.equal(status('0', '2026-12-01'), 'overdue')
    assert.equal(status('40', '2026-12-01'), 'overdue')
    assert.equal(status('100', '2026-12-01'), 'paid')
    assert.equal(owed(amounts('40')), '60.00')
  })

  test('Credit Notes come off what is owed, before Payments', ({ assert }) => {
    assert.equal(owed(amounts('40', '30')), '30.00')
    assert.equal(status('70', '2026-12-01', '30'), 'paid')
    assert.equal(status('0', '2026-12-01', '100'), 'paid')
    assert.equal(status('40', '2026-11-01', '30'), 'partly_paid')
    assert.equal(status('40', '2026-12-01', '30'), 'overdue')
    // Paid in full, then credited: overpaid, to refund
    assert.equal(status('100', '2026-11-01', '30'), 'overpaid')
    assert.equal(overpaidBy(amounts('100', '30')), '30.00')
    assert.isTrue(isSettled(amounts('70', '30')))
    assert.isFalse(isSettled(amounts('100', '30')))
  })

  test('paid beyond the total is overpaid, whatever the due date', ({ assert }) => {
    assert.equal(status('100.01', '2026-11-01'), 'overpaid')
    assert.equal(status('120', '2026-12-01'), 'overpaid')
    // What is owed goes below zero; refunds bring it back
    assert.equal(owed(amounts('120')), '-20.00')
    assert.equal(overpaidBy(amounts('120')), '20.00')
    assert.isNull(overpaidBy(amounts('100')))
    assert.equal(status('-10', '2026-11-01'), 'unpaid')
  })

  test('only exactly what is owed settles an Invoice', ({ assert }) => {
    assert.isTrue(isSettled(amounts('100')))
    assert.isFalse(isSettled(amounts('99.99')))
    assert.isFalse(isSettled(amounts('100.01')))
  })
})
