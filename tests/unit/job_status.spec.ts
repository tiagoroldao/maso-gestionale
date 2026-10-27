import { test } from '@japa/runner'
import { deriveJobStatus } from '#services/job_status'

test.group('Job status derivation', () => {
  test('work is complete when every Visit is done', ({ assert }) => {
    assert.equal(deriveJobStatus('in_progress', ['done', 'done']), 'work_complete')
  })

  test('any open or returning Visit keeps the Job in progress', ({ assert }) => {
    assert.equal(deriveJobStatus('in_progress', ['done', 'planned']), 'in_progress')
    assert.equal(deriveJobStatus('in_progress', ['done', 'needs_return']), 'in_progress')
    assert.equal(deriveJobStatus('in_progress', ['in_progress']), 'in_progress')
  })

  test('only Jobs in progress can be complete', ({ assert }) => {
    assert.equal(deriveJobStatus('quoted', ['done']), 'quoted')
    assert.equal(deriveJobStatus('cancelled', ['done']), 'cancelled')
    assert.equal(deriveJobStatus('in_progress', []), 'in_progress')
  })
})
