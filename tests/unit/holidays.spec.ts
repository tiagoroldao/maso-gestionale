import { test } from '@japa/runner'
import { easterSunday, italianHoliday } from '#shared/holidays'

test.group('Italian public holidays', () => {
  test('Easter Sunday by the Gregorian computus', ({ assert }) => {
    // Known dates, including the earliest possible Easter (22 March)
    const known: Record<number, string> = {
      2008: '2008-03-23',
      2019: '2019-04-21',
      2024: '2024-03-31',
      2025: '2025-04-20',
      2026: '2026-04-05',
      2027: '2027-03-28',
      2038: '2038-04-25',
      2285: '2285-03-22',
    }
    for (const [year, date] of Object.entries(known)) {
      assert.equal(easterSunday(Number(year)), date, year)
    }
  })

  test('Easter and Easter Monday move with the year', ({ assert }) => {
    assert.equal(italianHoliday('2026-04-05'), 'easter')
    assert.equal(italianHoliday('2026-04-06'), 'easterMonday')
    assert.equal(italianHoliday('2027-03-29'), 'easterMonday')
    assert.equal(italianHoliday('2025-04-21'), 'easterMonday')
    assert.isNull(italianHoliday('2026-04-07'))
  })

  test('the fixed national holidays', ({ assert }) => {
    const fixed = {
      '2026-01-01': 'newYear',
      '2026-01-06': 'epiphany',
      '2026-04-25': 'liberation',
      '2026-05-01': 'labour',
      '2026-06-02': 'republic',
      '2026-08-15': 'assumption',
      '2026-10-04': 'saintFrancis',
      '2026-11-01': 'allSaints',
      '2026-12-08': 'immaculate',
      '2026-12-25': 'christmas',
      '2026-12-26': 'saintStephen',
    }
    for (const [date, holiday] of Object.entries(fixed)) {
      assert.equal(italianHoliday(date), holiday, date)
    }
  })

  test('Saint Francis is a holiday only from 2026', ({ assert }) => {
    assert.isNull(italianHoliday('2025-10-04'))
    assert.equal(italianHoliday('2027-10-04'), 'saintFrancis')
  })

  test('working days and local patron saints are not holidays', ({ assert }) => {
    for (const date of ['2026-11-03', '2026-12-24', '2026-12-31', '2026-06-24', '2026-08-14']) {
      assert.isNull(italianHoliday(date), date)
    }
  })
})
