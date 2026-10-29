import { test } from '@japa/runner'
import { gridHours, layout, onDay, span } from '#shared/agenda'

const visit = (id: number, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt })

test.group('Agenda day grid', () => {
  test('a Visit across midnight shows on both days, cut at midnight', ({ assert }) => {
    const night = visit(1, '2026-11-03T22:00', '2026-11-04T02:00')

    assert.isTrue(onDay(night, '2026-11-03'))
    assert.isTrue(onDay(night, '2026-11-04'))
    assert.isFalse(onDay(night, '2026-11-05'))
    assert.deepEqual(span(night, '2026-11-03'), { start: 22 * 60, end: 24 * 60 })
    assert.deepEqual(span(night, '2026-11-04'), { start: 0, end: 2 * 60 })
    // The grid stretches to fit it on either day
    assert.deepEqual(gridHours([night], '2026-11-03'), { first: 7 * 60, last: 24 * 60 })
    assert.deepEqual(gridHours([night], '2026-11-04'), { first: 0, last: 20 * 60 })
  })

  test('a Visit ending at midnight is not on the next day; one over three days fills the middle', ({
    assert,
  }) => {
    const evening = visit(1, '2026-11-03T22:00', '2026-11-04T00:00')
    assert.isFalse(onDay(evening, '2026-11-04'))
    assert.deepEqual(span(evening, '2026-11-03'), { start: 22 * 60, end: 24 * 60 })

    const long = visit(2, '2026-11-03T20:00', '2026-11-05T08:00')
    assert.isTrue(onDay(long, '2026-11-04'))
    assert.deepEqual(span(long, '2026-11-04'), { start: 0, end: 24 * 60 })
  })

  test('a short Visit is a slot tall, never past midnight', ({ assert }) => {
    assert.deepEqual(span(visit(1, '2026-11-03T09:00', '2026-11-03T09:15'), '2026-11-03'), {
      start: 9 * 60,
      end: 9 * 60 + 30,
    })
    assert.deepEqual(span(visit(2, '2026-11-03T23:45', '2026-11-04T00:00'), '2026-11-03'), {
      start: 23 * 60 + 45,
      end: 24 * 60,
    })
  })

  test('on DST days a Visit sits at the wall-clock times it shows', ({ assert }) => {
    // Clocks go back on 25 October 2026 and forward on 28 March 2027
    const back = visit(1, '2026-10-25T01:30', '2026-10-25T03:30')
    const forward = visit(2, '2027-03-28T01:30', '2027-03-28T03:30')

    assert.deepEqual(span(back, '2026-10-25'), { start: 90, end: 210 })
    assert.deepEqual(span(forward, '2027-03-28'), { start: 90, end: 210 })
    assert.deepEqual(gridHours([back], '2026-10-25'), { first: 60, last: 20 * 60 })
  })

  test('only Visits on the day stretch the grid', ({ assert }) => {
    const early = visit(1, '2026-11-04T05:00', '2026-11-04T06:00')
    assert.deepEqual(gridHours([early], '2026-11-03'), { first: 7 * 60, last: 20 * 60 })
    assert.deepEqual(gridHours([early], '2026-11-04'), { first: 5 * 60, last: 20 * 60 })
  })

  test('overlapping Visits share the lane; the next free column is reused', ({ assert }) => {
    const day = '2026-11-03'
    const placed = layout(
      [
        visit(3, '2026-11-03T10:00', '2026-11-03T12:00'),
        visit(1, '2026-11-03T09:00', '2026-11-03T11:00'),
        visit(2, '2026-11-03T09:30', '2026-11-03T10:00'),
        // Apart from the others
        visit(4, '2026-11-03T14:00', '2026-11-03T15:00'),
      ],
      day
    )

    assert.deepEqual(Object.fromEntries(placed), {
      1: { column: 0, columns: 2 },
      2: { column: 1, columns: 2 },
      // Column 1 is free again from 10:00
      3: { column: 1, columns: 2 },
      4: { column: 0, columns: 1 },
    })
  })

  test("last night's Visit overlaps this morning's", ({ assert }) => {
    const placed = layout(
      [
        visit(1, '2026-11-04T00:30', '2026-11-04T02:00'),
        visit(2, '2026-11-03T23:00', '2026-11-04T01:00'),
      ],
      '2026-11-04'
    )

    assert.deepEqual(Object.fromEntries(placed), {
      2: { column: 0, columns: 2 },
      1: { column: 1, columns: 2 },
    })
  })
})
