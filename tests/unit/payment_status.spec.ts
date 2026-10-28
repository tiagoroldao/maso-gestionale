import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { outstanding, paymentStatus } from '#shared/payment_status'
import { deriveJobStatus } from '#services/job_status'

const due = '2026-11-30'
const status = (paid: string, today: string) =>
  paymentStatus({ total: '100.00', paid, dueOn: due, today })

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
    assert.equal(outstanding('100.00', '40'), '60.00')
    assert.equal(outstanding('100.00', '120'), '0.00')
  })
})

test.group('Job status from Invoices', () => {
  const done = [
    { status: 'done' as const, startsAt: DateTime.fromISO('2026-10-01'), survey: false },
  ]

  test('Invoiced once an Invoice is past draft; Closed when all are paid', ({ assert }) => {
    const issued = (paid: string) => ({ status: 'finalised', total: '100.00', paid })
    assert.equal(
      deriveJobStatus('in_progress', done, [{ status: 'draft', total: null, paid: '0' }]),
      'work_complete'
    )
    assert.equal(deriveJobStatus('in_progress', done, [issued('0')]), 'invoiced')
    assert.equal(deriveJobStatus('in_progress', done, [issued('100')]), 'closed')
    assert.equal(deriveJobStatus('open', [], [issued('100'), issued('40')]), 'invoiced')
    assert.equal(deriveJobStatus('cancelled', done, [issued('100')]), 'cancelled')
  })
})
