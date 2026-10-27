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
