import { test } from '@japa/runner'
import { formatDate, todayIso } from '#shared/dates'

test.group('Dates', () => {
  test('formats calendar dates the Italian way, without shifting the day', ({ assert }) => {
    assert.equal(formatDate('2026-05-20'), '20/05/2026')
    assert.equal(formatDate('2026-12-31T23:30:00Z'), '31/12/2026')
    assert.equal(formatDate(null), '')
  })

  test("today is Rome's date, not UTC's, around midnight", ({ assert }) => {
    // 23:30 UTC on 31 December is already 1 January in Rome (UTC+1 in winter)
    assert.equal(todayIso(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
    // 22:30 UTC on 30 June is 00:30 on 1 July in Rome (UTC+2 in summer)
    assert.equal(todayIso(new Date('2026-06-30T22:30:00Z')), '2026-07-01')
    assert.equal(todayIso(new Date('2026-06-30T21:30:00Z')), '2026-06-30')
  })
})
