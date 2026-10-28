import { test } from '@japa/runner'
import {
  INVOICE_STATUSES,
  InvalidTransitionError,
  canTransition,
  isDeletable,
  isEditable,
  transition,
  type InvoiceEvent,
} from '#shared/invoice_lifecycle'

test.group('Invoice lifecycle', () => {
  test('allows exactly the valid transitions', ({ assert }) => {
    const allowed: [string, InvoiceEvent, string][] = [
      ['draft', 'finalise', 'finalised'],
      ['finalised', 'submit', 'submitted'],
      ['rejected', 'submit', 'submitted'],
      ['submitted', 'deliver', 'delivered'],
      ['submitted', 'notDeliverable', 'not_deliverable'],
      ['submitted', 'reject', 'rejected'],
    ]
    const events: InvoiceEvent[] = ['finalise', 'submit', 'deliver', 'notDeliverable', 'reject']

    for (const from of INVOICE_STATUSES) {
      for (const event of events) {
        const expected = allowed.find(([f, e]) => f === from && e === event)
        assert.equal(canTransition(from, event), Boolean(expected), `${from} ${event}`)
        if (expected) {
          assert.equal(transition(from, event), expected[2])
        } else {
          assert.throws(() => transition(from, event), InvalidTransitionError)
        }
      }
    }
  })

  test('only drafts and rejected Invoices are editable; only drafts deletable', ({ assert }) => {
    assert.deepEqual(INVOICE_STATUSES.filter(isEditable), ['draft', 'rejected'])
    assert.deepEqual(INVOICE_STATUSES.filter(isDeletable), ['draft'])
  })
})
