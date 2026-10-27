import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import PaymentTerms from '#models/payment_terms'

function terms(days: number, endOfMonth: boolean) {
  return new PaymentTerms().merge({ name: 'x', days, endOfMonth })
}

const invoiceDate = DateTime.fromISO('2026-01-20')

test.group('PaymentTerms due date', () => {
  test('immediate payment is due on the invoice date', ({ assert }) => {
    assert.equal(terms(0, false).dueDate(invoiceDate).toISODate(), '2026-01-20')
  })

  test('30 days', ({ assert }) => {
    assert.equal(terms(30, false).dueDate(invoiceDate).toISODate(), '2026-02-19')
  })

  test('30 days end of month', ({ assert }) => {
    assert.equal(terms(30, true).dueDate(invoiceDate).toISODate(), '2026-02-28')
  })

  test('end of month on its own is the end of the invoice month', ({ assert }) => {
    assert.equal(terms(0, true).dueDate(invoiceDate).toISODate(), '2026-01-31')
  })
})
