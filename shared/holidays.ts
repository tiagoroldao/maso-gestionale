import { addDays } from './dates.js'

/**
 * Italian national public holidays (#177), worked out without any outside
 * service: fixed dates plus Easter and Easter Monday. Local patron saints'
 * days aren't national and aren't listed. Dates are calendar dates
 * ("2026-04-06"), with no timezone.
 */

export const HOLIDAYS = [
  'newYear',
  'epiphany',
  'easter',
  'easterMonday',
  'liberation',
  'labour',
  'republic',
  'assumption',
  'saintFrancis',
  'allSaints',
  'immaculate',
  'christmas',
  'saintStephen',
] as const

export type Holiday = (typeof HOLIDAYS)[number]

/** Fixed-date holidays by "MM-DD", with the first year they apply from. */
const FIXED: Record<string, { holiday: Holiday; since?: number }> = {
  '01-01': { holiday: 'newYear' },
  '01-06': { holiday: 'epiphany' },
  '04-25': { holiday: 'liberation' },
  '05-01': { holiday: 'labour' },
  '06-02': { holiday: 'republic' },
  '08-15': { holiday: 'assumption' },
  // Restored as a national holiday from 2026 (legge 151/2025)
  '10-04': { holiday: 'saintFrancis', since: 2026 },
  '11-01': { holiday: 'allSaints' },
  '12-08': { holiday: 'immaculate' },
  '12-25': { holiday: 'christmas' },
  '12-26': { holiday: 'saintStephen' },
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * Easter Sunday of a Gregorian year, as "YYYY-MM-DD" (the anonymous
 * Gregorian algorithm, also known as Meeus/Jones/Butcher).
 */
export function easterSunday(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * The national public holiday falling on `isoDate`, or null on a working
 * day.
 */
export function italianHoliday(isoDate: string): Holiday | null {
  const year = Number(isoDate.slice(0, 4))
  const fixed = FIXED[isoDate.slice(5, 10)]
  if (fixed && (!fixed.since || year >= fixed.since)) return fixed.holiday
  const easter = easterSunday(year)
  if (isoDate === easter) return 'easter'
  if (isoDate === addDays(easter, 1)) return 'easterMonday'
  return null
}
