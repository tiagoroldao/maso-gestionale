import type { DateTime } from 'luxon'

/**
 * A moment as the pages use it: local business time without offset,
 * "2026-10-27T08:30". The server runs in Europe/Rome (ADR 0006).
 */
export function localDateTime(moment: DateTime) {
  return moment.toFormat("yyyy-MM-dd'T'HH:mm")
}
