import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Visit from '#models/visit'

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' })

function visit(startsAt: string, startedAt: string | null = null) {
  return new Visit().merge({ startsAt: at(startsAt), startedAt: startedAt ? at(startedAt) : null })
}

test.group('Visit work day (#174)', () => {
  const now = at('2026-10-29T10:00:00Z')

  test('the day it was marked in progress, in Rome', ({ assert }) => {
    // 23:30 UTC on 27 October is 00:30 on 28 October in Rome
    assert.equal(
      visit('2026-10-30T08:00:00Z', '2026-10-27T23:30:00Z').workDay(now).toISODate(),
      '2026-10-28'
    )
  })

  test('its planned day when never marked in progress', ({ assert }) => {
    assert.equal(visit('2026-10-27T22:30:00Z').workDay(now).toISODate(), '2026-10-27')
    assert.equal(visit('2026-10-26T08:00:00Z').workDay(now).toISODate(), '2026-10-26')
  })

  test('never later than today', ({ assert }) => {
    assert.equal(visit('2026-11-05T08:00:00Z').workDay(now).toISODate(), '2026-10-29')
    assert.equal(
      visit('2026-11-05T08:00:00Z', '2026-10-30T08:00:00Z').workDay(now).toISODate(),
      '2026-10-29'
    )
  })
})
