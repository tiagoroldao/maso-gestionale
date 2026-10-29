/**
 * Where Visits sit on the Agenda's day grid. Times are the Europe/Rome
 * wall-clock strings the server sends (`yyyy-MM-ddTHH:mm`), so on a DST
 * day a Visit sits at the times it shows, and a day is always 24 hours
 * of grid.
 */

export const SLOT_MINUTES = 30

const DAY_MINUTES = 24 * 60

export type AgendaVisit = { id: number; startsAt: string; endsAt: string }

export type Placement = { column: number; columns: number }

const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))

/**
 * Whether the Visit takes up part of `day` (ISO): one running past
 * midnight shows on each day it covers, and one ending at midnight
 * doesn't show on the next.
 */
export function onDay(visit: AgendaVisit, day: string) {
  return visit.startsAt.slice(0, 10) <= day && visit.endsAt > `${day}T00:00`
}

/**
 * Whether the Visit starts on `day` (ISO). Only there does its block show
 * its start time at the top, so only there can it be dragged: on a later
 * day the block starts at midnight, and a drop would move the Visit there.
 */
export function startsOn(visit: AgendaVisit, day: string) {
  return visit.startsAt.slice(0, 10) === day
}

/**
 * Where a Visit sits on `day`, in minutes from midnight: cut at midnight
 * on either side, and at least a slot tall.
 */
export function span(visit: AgendaVisit, day: string) {
  const start = visit.startsAt.slice(0, 10) === day ? minutesOf(visit.startsAt) : 0
  const end = visit.endsAt.slice(0, 10) === day ? minutesOf(visit.endsAt) : DAY_MINUTES
  return { start, end: Math.min(Math.max(end, start + SLOT_MINUTES), DAY_MINUTES) }
}

/**
 * The hours the day grid shows: 07:00–20:00, stretched to whole hours to
 * fit any earlier or later Visit on `day` (night call-outs).
 */
export function gridHours(visits: AgendaVisit[], day: string) {
  const spans = visits.filter((visit) => onDay(visit, day)).map((visit) => span(visit, day))
  const first = Math.min(7 * 60, ...spans.map((s) => Math.floor(s.start / 60) * 60))
  const last = Math.max(20 * 60, ...spans.map((s) => Math.ceil(s.end / 60) * 60))
  return { first, last: Math.min(last, DAY_MINUTES) }
}

/**
 * Overlapping Visits in one lane on `day` share its width side by side,
 * so a double booking is visible rather than hidden: each Visit's column,
 * and how many columns its group of overlapping Visits has.
 */
export function layout(visits: AgendaVisit[], day: string) {
  const sorted = [...visits].sort((a, b) => span(a, day).start - span(b, day).start)
  const placed = new Map<number, Placement>()
  let columnEnds: number[] = []
  let cluster: AgendaVisit[] = []
  let clusterEnd = -1

  const close = () => {
    const columns = Math.max(...cluster.map((visit) => placed.get(visit.id)!.column)) + 1
    for (const visit of cluster) placed.get(visit.id)!.columns = columns
    cluster = []
    columnEnds = []
  }

  for (const visit of sorted) {
    const { start, end } = span(visit, day)
    if (cluster.length && start >= clusterEnd) close()
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = end
    placed.set(visit.id, { column, columns: 1 })
    cluster.push(visit)
    clusterEnd = Math.max(clusterEnd, end)
  }
  if (cluster.length) close()
  return placed
}
