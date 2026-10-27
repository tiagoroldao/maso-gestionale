import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { VisitStatus } from '#models/visit'
import { deriveJobStatus } from '#services/job_status'

/**
 * Visits on consecutive days, in the given statuses.
 */
function visits(...statuses: VisitStatus[]) {
  const day = DateTime.fromISO('2026-11-02T09:00')
  return statuses.map((status, i) => ({ status, startsAt: day.plus({ days: i }) }))
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
    assert.equal(deriveJobStatus('quoted', visits('done')), 'quoted')
    assert.equal(deriveJobStatus('cancelled', visits('done')), 'cancelled')
    assert.equal(deriveJobStatus('in_progress', []), 'in_progress')
  })
})
