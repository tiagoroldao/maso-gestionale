import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { VisitStatus } from '#models/visit'
import { jobIndicators } from '#services/job_status'

const day = DateTime.fromISO('2026-11-02T09:00')

/**
 * Work Visits on consecutive days, in the given statuses.
 */
function visits(...statuses: VisitStatus[]) {
  return statuses.map((status, i) => ({ status, startsAt: day.plus({ days: i }), survey: false }))
}

/**
 * The same, as Surveys.
 */
function surveys(...statuses: VisitStatus[]) {
  return visits(...statuses).map((visit) => ({ ...visit, survey: true }))
}

const workComplete = (list: ReturnType<typeof visits>) =>
  jobIndicators(list, [], false).workComplete

test.group('Job indicators: work complete', () => {
  test('work is complete when every Visit is done', ({ assert }) => {
    assert.isTrue(workComplete(visits('done', 'done')))
  })

  test('a Visit needing a return counts once the follow-up exists and is done', ({ assert }) => {
    assert.isTrue(workComplete(visits('needs_return', 'done')))
    assert.isFalse(workComplete(visits('done', 'needs_return')))
    assert.isFalse(workComplete(visits('needs_return', 'planned')))
  })

  test('any planned or ongoing Visit keeps work going', ({ assert }) => {
    assert.isFalse(workComplete(visits('done', 'planned')))
    assert.isFalse(workComplete(visits('in_progress')))
  })

  test('a Job without Visits has no work done', ({ assert }) => {
    assert.isFalse(workComplete([]))
  })

  test('Surveys alone are no work done, but one still to do keeps work going', ({ assert }) => {
    assert.isFalse(workComplete(surveys('done')))
    const work = { status: 'done' as const, startsAt: day.plus({ days: 5 }), survey: false }
    assert.isTrue(workComplete([...surveys('done'), work]))
    assert.isFalse(workComplete([work, ...surveys('planned')]))
  })
})

test.group('Job indicators: invoiced and paid', () => {
  const issued = (paid: string, credited = '0') => ({
    status: 'finalised',
    total: '100.00',
    credited,
    paid,
  })
  const draft = { status: 'draft', total: null, credited: '0', paid: '0' }

  test('invoiced once an Invoice is past draft and nothing is left to bill', ({ assert }) => {
    assert.isFalse(jobIndicators([], [], false).invoiced)
    assert.isFalse(jobIndicators([], [draft], false).invoiced)
    assert.isTrue(jobIndicators([], [issued('0')], false).invoiced)
    // Something still to bill: the Invoice was a partial one
    assert.isFalse(jobIndicators([], [issued('0')], true).invoiced)
  })

  test('paid when every issued Invoice is settled', ({ assert }) => {
    assert.isFalse(jobIndicators([], [], false).paid)
    assert.isFalse(jobIndicators([], [draft], false).paid)
    assert.isFalse(jobIndicators([], [issued('0')], false).paid)
    assert.isTrue(jobIndicators([], [issued('100')], false).paid)
    assert.isFalse(jobIndicators([], [issued('100'), issued('40')], false).paid)
    // An overpaid Invoice isn't settled
    assert.isFalse(jobIndicators([], [issued('100.01')], false).paid)
    // Paid doesn't wait for billing: the issued Invoices are settled
    assert.isTrue(jobIndicators([], [issued('100'), draft], true).paid)
    // Credit Notes settle what they credit; crediting a paid Invoice overpays it
    assert.isTrue(jobIndicators([], [issued('60', '40')], false).paid)
    assert.isFalse(jobIndicators([], [issued('100', '40')], false).paid)
  })

  test('the three are independent of each other', ({ assert }) => {
    assert.deepEqual(jobIndicators(visits('done'), [issued('100')], false), {
      workComplete: true,
      invoiced: true,
      paid: true,
    })
    assert.deepEqual(jobIndicators(visits('planned'), [issued('100')], false), {
      workComplete: false,
      invoiced: true,
      paid: true,
    })
  })
})
