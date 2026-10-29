import { test } from '@japa/runner'
import { MAX_REPEATED_VISITS, repeatedDates } from '#shared/visit_repeats'
import { addDays, isoWeekday } from '#shared/dates'

test.group('Repeated Visit dates', () => {
  test('every day until a date, both ends included', ({ assert }) => {
    const { dates, truncated } = repeatedDates({
      from: '2026-11-02',
      frequency: 'daily',
      until: '2026-11-05',
    })
    assert.deepEqual(dates, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
    assert.isFalse(truncated)
  })

  test('on weekdays, skipping the weekend', ({ assert }) => {
    // Friday 6 November, for four Visits
    const { dates } = repeatedDates({ from: '2026-11-06', frequency: 'weekdays', count: 4 })
    assert.deepEqual(dates, ['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11'])
  })

  test('a start that misses the pattern is left out', ({ assert }) => {
    // Saturday 7 November
    const { dates } = repeatedDates({ from: '2026-11-07', frequency: 'weekdays', count: 2 })
    assert.deepEqual(dates, ['2026-11-09', '2026-11-10'])
  })

  test('on chosen days of the week', ({ assert }) => {
    // Mondays and Thursdays, from Tuesday 3 November until the 16th
    const { dates } = repeatedDates({
      from: '2026-11-03',
      frequency: 'days',
      weekdays: [1, 4],
      until: '2026-11-16',
    })
    assert.deepEqual(dates, ['2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16'])
    assert.deepEqual(dates.map(isoWeekday), [4, 1, 4, 1])
  })

  test('no chosen day gives no dates', ({ assert }) => {
    const { dates } = repeatedDates({ from: '2026-11-03', frequency: 'days', count: 3 })
    assert.deepEqual(dates, [])
  })

  test('the earlier of a date and a count ends it', ({ assert }) => {
    const byCount = repeatedDates({
      from: '2026-11-02',
      frequency: 'daily',
      until: '2026-11-30',
      count: 2,
    })
    assert.deepEqual(byCount.dates, ['2026-11-02', '2026-11-03'])
    const byDate = repeatedDates({
      from: '2026-11-02',
      frequency: 'daily',
      until: '2026-11-03',
      count: 10,
    })
    assert.deepEqual(byDate.dates, ['2026-11-02', '2026-11-03'])
  })

  test('a long range stops at the most Visits planned at once', ({ assert }) => {
    const { dates, truncated } = repeatedDates({
      from: '2026-11-02',
      frequency: 'daily',
      until: '2027-12-31',
    })
    assert.lengthOf(dates, MAX_REPEATED_VISITS)
    assert.equal(dates.at(-1), addDays('2026-11-02', MAX_REPEATED_VISITS - 1))
    assert.isTrue(truncated)
  })

  test('crosses month, year and daylight saving changes', ({ assert }) => {
    // Clocks go back on 25 October 2026
    const autumn = repeatedDates({ from: '2026-10-24', frequency: 'daily', count: 3 })
    assert.deepEqual(autumn.dates, ['2026-10-24', '2026-10-25', '2026-10-26'])
    const newYear = repeatedDates({ from: '2026-12-31', frequency: 'daily', count: 2 })
    assert.deepEqual(newYear.dates, ['2026-12-31', '2027-01-01'])
  })
})
