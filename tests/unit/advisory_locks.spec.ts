import { test } from '@japa/runner'
import { ADVISORY_LOCKS } from '#services/advisory_locks'

test.group('Advisory lock keys', () => {
  test('each lock has a key of its own', ({ assert }) => {
    const keys = Object.values(ADVISORY_LOCKS)
    assert.equal(new Set(keys).size, keys.length)
  })
})
