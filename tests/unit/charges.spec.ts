import { test } from '@japa/runner'
import {
  canSetBackToBill,
  chargeState,
  isDraftable,
  isHeld,
  isOutstanding,
  isVisitBilled,
  workState,
  type ChargeState,
  type WorkState,
} from '#shared/charges'

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
    const done = (...states: ChargeState[]) =>
      states.map((state) => ({ state, work: 'done' as const }))
    assert.isTrue(isVisitBilled('done', done('billed', 'not_billable')))
    assert.isTrue(isVisitBilled('needs_return', done('billed', 'credited')))
    assert.isTrue(isVisitBilled('done', []))
    assert.isFalse(isVisitBilled('done', done('billed', 'in_draft')))
    assert.isFalse(isVisitBilled('done', done('to_bill')))
    assert.isFalse(isVisitBilled('planned', done('billed')))
    assert.isFalse(isVisitBilled('in_progress', []))
    // Work not done is never outstanding (ADR 0016)
    assert.isTrue(
      isVisitBilled('done', [...done('billed'), { state: 'to_bill', work: 'not_done' }])
    )
  })

  test('a cancelled Visit leaves nothing to bill (#157)', ({ assert }) => {
    assert.isTrue(isVisitBilled('cancelled', []))
    assert.isTrue(isVisitBilled('cancelled', [{ state: 'to_bill', work: 'not_done' }]))
  })
})

test.group('Work state', () => {
  test('planned until a work event, then the latest one', ({ assert }) => {
    assert.equal(workState(events('recorded')), 'planned')
    assert.equal(workState(events('recorded', 'done')), 'done')
    assert.equal(workState(events('recorded', 'not_done')), 'not_done')
    assert.equal(workState(events('recorded', 'done', 'not_done', 'done')), 'done')
    assert.equal(workState(events('recorded', 'not_done', 'planned')), 'planned')
    // Billing events leave it alone, and it leaves the billing state alone
    assert.equal(workState(events('recorded', 'done', 'billed', 'unbilled')), 'done')
    assert.equal(chargeState(events('recorded', 'not_done'), false), 'to_bill')
    assert.equal(chargeState(events('recorded', 'done', 'not_billable'), false), 'not_billable')
  })

  test('planned work keeps billing open; work not done never does', ({ assert }) => {
    const cases: [ChargeState, WorkState, boolean, boolean][] = [
      // state, work, outstanding, draftable
      ['to_bill', 'planned', true, false],
      ['to_bill', 'done', true, true],
      ['to_bill', 'not_done', false, false],
      ['in_draft', 'done', true, false],
      ['not_billable', 'planned', false, false],
      ['not_billable', 'done', false, false],
      ['billed', 'done', false, false],
      ['credited', 'done', false, false],
    ]
    for (const [state, work, outstanding, draftable] of cases) {
      assert.equal(isOutstanding(state, work), outstanding, `${state} ${work}`)
      assert.equal(isDraftable(state, work), draftable, `${state} ${work}`)
    }
  })
})
