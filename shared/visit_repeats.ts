import { addDays, isoWeekday } from './dates.js'

/**
 * How a Visit planned for a long Job repeats (#177): every day, on
 * weekdays (Monday to Friday), or on chosen days of the week. Each date
 * becomes an ordinary, independent Visit; there is no series.
 */
export const REPEAT_FREQUENCIES = ['daily', 'weekdays', 'days'] as const

export type RepeatFrequency = (typeof REPEAT_FREQUENCIES)[number]

/** The most Visits planned at once. */
export const MAX_REPEATED_VISITS = 60

/** Days of the week, ISO style: 1 is Monday, 7 Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

function repeatsOn(frequency: RepeatFrequency, weekdays: readonly number[], isoDate: string) {
  const weekday = isoWeekday(isoDate)
  if (frequency === 'daily') return true
  if (frequency === 'weekdays') return weekday <= 5
  return weekdays.includes(weekday)
}

/**
 * The dates a repeated Visit falls on, from `from` (included when it fits
 * the pattern) until `until` (included) or for `count` Visits, whichever
 * is given. At most MAX_REPEATED_VISITS dates; `truncated` says more would
 * have followed before `until`.
 */
export function repeatedDates(options: {
  from: string
  frequency: RepeatFrequency
  weekdays?: readonly number[]
  until?: string | null
  count?: number | null
}) {
  const { from, frequency, weekdays = [], until, count } = options
  const limit = Math.min(count ?? MAX_REPEATED_VISITS, MAX_REPEATED_VISITS)
  const dates: string[] = []
  if (frequency === 'days' && weekdays.length === 0) return { dates, truncated: false }
  let date = from
  for (;;) {
    if (until && date > until) return { dates, truncated: false }
    if (repeatsOn(frequency, weekdays, date)) {
      if (dates.length === limit) return { dates, truncated: !count }
      dates.push(date)
    }
    date = addDays(date, 1)
  }
}
