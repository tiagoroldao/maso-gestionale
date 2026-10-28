import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { VisitStatus } from '#models/visit'
import { deriveJobStatus } from '#services/job_status'

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

test.group('Job status derivation', () => {
  test('work is complete when every Visit is done', ({ assert }) => {
    assert.equal(deriveJobStatus('in_progress', visits('done', 'done')), 'work_complete')
  })

  test('a Visit needing a return counts once the follow-up exists and is done', ({ assert }) => {
    assert.equal(deriveJobStatus('in_progress', visits('needs_return', 'done')), 'work_complete')
    assert.equal(deriveJobStatus('in_progress', visits('done', 'needs_return')), 'in_progress')
    assert.equal(deriveJobStatus('in_progress', visits('needs_return', 'planned')), 'in_progress')
  })

  test('any planned or ongoing Visit keeps the Job in progress', ({ assert }) => {
    assert.equal(deriveJobStatus('in_progress', visits('done', 'planned')), 'in_progress')
    assert.equal(deriveJobStatus('in_progress', visits('in_progress')), 'in_progress')
  })

  test('only Jobs in progress can be complete', ({ assert }) => {
    assert.equal(deriveJobStatus('open', visits('done')), 'open')
    assert.equal(deriveJobStatus('cancelled', visits('done')), 'cancelled')
    assert.equal(deriveJobStatus('in_progress', []), 'in_progress')
  })

  test('Surveys alone are no work done, but one still to do keeps work going', ({ assert }) => {
    assert.equal(deriveJobStatus('in_progress', surveys('done')), 'in_progress')
    assert.equal(deriveJobStatus('open', surveys('done')), 'open')
    const work = { status: 'done' as const, startsAt: day.plus({ days: 5 }), survey: false }
    assert.equal(deriveJobStatus('in_progress', [...surveys('done'), work]), 'work_complete')
    assert.equal(deriveJobStatus('in_progress', [work, ...surveys('planned')]), 'in_progress')
  })
})
