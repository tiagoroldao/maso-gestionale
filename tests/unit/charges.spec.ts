import { test } from '@japa/runner'
import { canSetBackToBill, chargeState, isHeld, isVisitBilled } from '#shared/charges'

const events = (...kinds: string[]) => kinds.map((kind) => ({ kind }))

test.group('Charge state', () => {
  test('to bill until a draft holds it, billed once an issued Invoice does', ({ assert }) => {
    assert.equal(chargeState(events('recorded'), false), 'to_bill')
    assert.equal(chargeState(events('recorded'), true), 'in_draft')
    assert.equal(chargeState(events('recorded', 'billed'), false), 'billed')
  })

  test('set back to bill, it is to bill or held again', ({ assert }) => {
    assert.equal(chargeState(events('recorded', 'billed', 'unbilled'), false), 'to_bill')
    assert.equal(chargeState(events('recorded', 'billed', 'unbilled'), true), 'in_draft')
    assert.equal(chargeState(events('billed', 'unbilled', 'billed'), false), 'billed')
  })

  test('credited by Credit Notes until set back to bill or uncredited', ({ assert }) => {
    assert.equal(chargeState(events('recorded', 'billed', 'credited'), false), 'credited')
    assert.equal(chargeState(events('billed', 'credited', 'uncredited'), false), 'billed')
    assert.equal(chargeState(events('billed', 'credited', 'unbilled'), false), 'to_bill')
    assert.equal(chargeState(events('billed', 'credited', 'unbilled'), true), 'in_draft')
    assert.equal(chargeState(events('billed', 'credited', 'unbilled', 'billed'), false), 'billed')
    // Final, and frozen until set back to bill
    assert.isTrue(isHeld('credited'))
    assert.isTrue(canSetBackToBill('credited'))
    assert.isTrue(canSetBackToBill('billed'))
    assert.isFalse(canSetBackToBill('in_draft'))
  })

  test('the latest decision makes it not billable', ({ assert }) => {
    assert.equal(chargeState(events('recorded', 'not_billable'), false), 'not_billable')
    assert.equal(chargeState(events('not_billable', 'billable'), false), 'to_bill')
    assert.equal(chargeState(events('billed', 'unbilled', 'not_billable'), false), 'not_billable')
  })

  test('a Visit is billed once closed with nothing outstanding', ({ assert }) => {
    assert.isTrue(isVisitBilled(true, ['billed', 'not_billable']))
    assert.isTrue(isVisitBilled(true, ['billed', 'credited']))
    assert.isTrue(isVisitBilled(true, []))
    assert.isFalse(isVisitBilled(true, ['billed', 'in_draft']))
    assert.isFalse(isVisitBilled(true, ['to_bill']))
    assert.isFalse(isVisitBilled(false, ['billed']))
  })
})
