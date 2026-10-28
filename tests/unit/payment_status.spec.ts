import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { isSettled, overpaidBy, owed, paymentStatus } from '#shared/payment_status'
import { deriveJobStatus } from '#services/job_status'

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

test.group('Job status from Invoices', () => {
  const done = [
    { status: 'done' as const, startsAt: DateTime.fromISO('2026-10-01'), survey: false },
  ]

  test('Invoiced once an Invoice is past draft; Closed when all are settled', ({ assert }) => {
    const issued = (paid: string, credited = '0') => ({
      status: 'finalised',
      total: '100.00',
      credited,
      paid,
    })
    assert.equal(
      deriveJobStatus('in_progress', done, [
        { status: 'draft', total: null, credited: '0', paid: '0' },
      ]),
      'work_complete'
    )
    assert.equal(deriveJobStatus('in_progress', done, [issued('0')]), 'invoiced')
    assert.equal(deriveJobStatus('in_progress', done, [issued('100')]), 'closed')
    assert.equal(deriveJobStatus('open', [], [issued('100'), issued('40')]), 'invoiced')
    assert.equal(deriveJobStatus('cancelled', done, [issued('100')]), 'cancelled')
    // An overpaid Invoice isn't settled
    assert.equal(deriveJobStatus('in_progress', done, [issued('100.01')]), 'invoiced')
    // Credit Notes settle what they credit; crediting a paid Invoice overpays it
    assert.equal(deriveJobStatus('in_progress', done, [issued('60', '40')]), 'closed')
    assert.equal(deriveJobStatus('in_progress', done, [issued('100', '40')]), 'invoiced')
  })
})
