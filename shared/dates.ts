/**
 * Calendar dates as the business uses them (ADR 0006): Europe/Rome, shown
 * as dd/mm/yyyy. Used by the server and the Vue pages alike.
 */

export const TIME_ZONE = 'Europe/Rome'

/**
 * A calendar date ("2026-05-20") as the business writes it ("20/05/2026"),
 * without any timezone conversion.
 */
export function formatDate(isoDate: string | null | undefined) {
  if (!isoDate) return ''
  const [year, month, day] = isoDate.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/**
 * The date in the business's timezone at `now`, as "YYYY-MM-DD".
 */
export function todayIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * A moment (an ISO timestamp) as the business reads it in Europe/Rome:
 * "28/10/2026 01:30".
 */
export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * The calendar date `days` after `isoDate` (before, if negative), without
 * any timezone conversion.
 */
export function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * The day of the week of a calendar date, ISO style: 1 is Monday, 7 Sunday.
 */
export function isoWeekday(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7
}
