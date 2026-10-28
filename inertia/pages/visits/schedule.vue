<script setup lang="ts">
import { isClosedVisit } from '@shared/visits'
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, t, todayIso } from '~/i18n'

type CalendarVisit = {
  id: number
  startsAt: string
  endsAt: string
  status: string
  technicianIds: number[]
  job: { id: number; number: string; title: string; customer: string; site: string | null }
}

const props = defineProps<{
  view: 'day' | 'week'
  date: string
  from: string
  days: string[]
  technicians: { id: number; name: string; active: boolean }[]
  visits: CalendarVisit[]
}>()

const SLOT_MINUTES = 30
const SLOT_HEIGHT = 24

const time = (iso: string) => iso.slice(11, 16)
const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))
const pad = (n: number) => String(n).padStart(2, '0')
const label = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

/**
 * Where a Visit sits on the day's grid, in minutes from midnight; a Visit
 * running past midnight is cut at the end of the day.
 */
function span(visit: CalendarVisit) {
  const start = visit.startsAt.slice(0, 10) === props.date ? minutesOf(visit.startsAt) : 0
  const end = visit.endsAt.slice(0, 10) === props.date ? minutesOf(visit.endsAt) : 24 * 60
  return { start, end: Math.max(end, start + SLOT_MINUTES) }
}

/**
 * The day grid runs 07:00–20:00 in half-hour slots, stretched to fit any
 * earlier or later Visit (night call-outs).
 */
const grid = computed(() => {
  const spans = props.visits.filter((visit) => visit.startsAt.slice(0, 10) === props.date).map(span)
  const first = Math.min(7 * 60, ...spans.map((s) => Math.floor(s.start / 60) * 60))
  const last = Math.max(20 * 60, ...spans.map((s) => Math.ceil(s.end / 60) * 60))
  return { first, last: Math.min(last, 24 * 60) }
})
const slots = computed(() =>
  Array.from(
    { length: (grid.value.last - grid.value.first) / SLOT_MINUTES },
    (_, i) => grid.value.first + i * SLOT_MINUTES
  )
)

function shiftDate(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

function go(date: string, view = props.view) {
  router.get(urlFor('visits.schedule'), { date, view }, { preserveScroll: true })
}

const step = computed(() => (props.view === 'week' ? 7 : 1))

function visitsFor(technicianId: number, day: string) {
  return props.visits.filter(
    (visit) => visit.technicianIds.includes(technicianId) && visit.startsAt.slice(0, 10) === day
  )
}

/**
 * Overlapping Visits in one lane share its width side by side, so a double
 * booking is visible rather than hidden.
 */
function layout(visits: CalendarVisit[]) {
  const sorted = [...visits].sort((a, b) => span(a).start - span(b).start)
  const placed = new Map<number, { column: number; columns: number }>()
  let columnEnds: number[] = []
  let cluster: CalendarVisit[] = []
  let clusterEnd = -1

  const close = () => {
    const columns = Math.max(...cluster.map((visit) => placed.get(visit.id)!.column)) + 1
    for (const visit of cluster) placed.get(visit.id)!.columns = columns
    cluster = []
    columnEnds = []
  }

  for (const visit of sorted) {
    const { start, end } = span(visit)
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

function blockStyle(visit: CalendarVisit, placement?: { column: number; columns: number }) {
  const { start, end } = span(visit)
  const { column = 0, columns = 1 } = placement ?? {}
  return {
    top: `${((start - grid.value.first) / SLOT_MINUTES) * SLOT_HEIGHT}px`,
    height: `${((end - start) / SLOT_MINUTES) * SLOT_HEIGHT}px`,
    left: `calc(${(column / columns) * 100}% + 2px)`,
    width: `calc(${100 / columns}% - 4px)`,
    right: 'auto',
  }
}

const dragging = ref<{
  visitId: number
  fromTechnicianId: number
  startsAt: string
  grabMinutes: number
} | null>(null)

/**
 * Closed Visits (done, or needing another visit) can't move: the server
 * refuses them too.
 */
function isOpen(visit: CalendarVisit) {
  return !isClosedVisit(visit.status)
}

function onDragStart(event: DragEvent, visit: CalendarVisit, technicianId: number) {
  if (!isOpen(visit)) return
  // Firefox only starts a drag with some data set
  event.dataTransfer?.setData('text/plain', String(visit.id))
  // How far into the Visit it was grabbed, so dropping on another lane at
  // the same height keeps the same start time
  const block = event.currentTarget as HTMLElement
  const grabbedAt = event.clientY - block.getBoundingClientRect().top
  dragging.value = {
    visitId: visit.id,
    fromTechnicianId: technicianId,
    startsAt: visit.startsAt,
    // Exact (not rounded), so the drop rounds only once
    grabMinutes: (Math.max(grabbedAt, 0) / SLOT_HEIGHT) * SLOT_MINUTES,
  }
}

function moveTo(technicianId: number, startsAt: string) {
  const drag = dragging.value
  dragging.value = null
  if (!drag) return
  if (drag.startsAt.slice(0, 16) === startsAt && drag.fromTechnicianId === technicianId) return

  router.patch(
    urlFor('visits.move', { id: drag.visitId }),
    { startsAt, fromTechnicianId: drag.fromTechnicianId, toTechnicianId: technicianId },
    { preserveScroll: true }
  )
}

/**
 * Day view: the drop position, less where the Visit was grabbed, picks the
 * new start slot.
 */
function onDayDrop(event: DragEvent, technicianId: number) {
  if (!dragging.value) return
  const column = event.currentTarget as HTMLElement
  const offset = event.clientY - column.getBoundingClientRect().top
  const pointed = grid.value.first + (offset / SLOT_HEIGHT) * SLOT_MINUTES
  // Rounded once, to the quarter hour planning allows
  const exact = Math.round((pointed - dragging.value.grabMinutes) / 15) * 15
  const start = Math.max(0, Math.min(24 * 60 - 15, exact))
  moveTo(technicianId, `${props.date}T${label(start)}`)
}

/**
 * Week view: a new day (and lane), same time of day.
 */
function onWeekDrop(technicianId: number, day: string) {
  if (!dragging.value) return
  moveTo(technicianId, `${day}T${time(dragging.value.startsAt)}`)
}

const weekday = (iso: string) =>
  new Intl.DateTimeFormat('it', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`)
  )
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.visits.scheduleTitle')">
      <template #actions>
        <Link route="visits.to_schedule" class="btn btn--ghost btn--sm">
          {{ t('ui.toSchedule.title') }}
        </Link>
        <button type="button" class="btn btn--ghost btn--sm" @click="go(todayIso())">
          {{ t('ui.visits.today') }}
        </button>
        <button
          type="button"
          class="btn btn--secondary btn--sm"
          @click="go(date, view === 'day' ? 'week' : 'day')"
        >
          {{ view === 'day' ? t('ui.visits.weekView') : t('ui.visits.dayView') }}
        </button>
      </template>

      <div :style="{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }">
        <button
          type="button"
          class="iconbtn"
          :aria-label="t('ui.visits.previous')"
          @click="go(shiftDate(date, -step))"
        >
          <ChevronLeft :size="16" />
        </button>
        <strong>
          {{
            view === 'day'
              ? `${weekday(date)} ${formatDate(date)}`
              : t('ui.visits.weekOf', { from: formatDate(days[0]), to: formatDate(days[6]) })
          }}
        </strong>
        <button
          type="button"
          class="iconbtn"
          :aria-label="t('ui.visits.next')"
          @click="go(shiftDate(date, step))"
        >
          <ChevronRight :size="16" />
        </button>
      </div>

      <p v-if="technicians.length === 0" class="field__hint">{{ t('ui.visits.noTechnicians') }}</p>

      <div v-else-if="view === 'day'" class="agenda agenda--day">
        <div class="agenda__times">
          <div class="agenda__header" />
          <div
            v-for="slot in slots"
            :key="slot"
            class="agenda__time"
            :style="{ height: `${SLOT_HEIGHT}px` }"
          >
            {{ slot % 60 === 0 ? label(slot) : '' }}
          </div>
        </div>
        <div v-for="technician in technicians" :key="technician.id" class="agenda__lane">
          <div class="agenda__header">
            {{ technician.name }}
            <span v-if="!technician.active" class="field__hint">{{ t('ui.visits.inactive') }}</span>
          </div>
          <div
            class="agenda__column"
            :data-technician="technician.id"
            :style="{ height: `${slots.length * SLOT_HEIGHT}px` }"
            @dragover.prevent
            @drop.prevent="onDayDrop($event, technician.id)"
          >
            <div
              v-for="visit in visitsFor(technician.id, date)"
              :key="visit.id"
              class="agenda__visit"
              :class="`agenda__visit--${visit.status}`"
              :style="blockStyle(visit, layout(visitsFor(technician.id, date)).get(visit.id))"
              :draggable="isOpen(visit) ? 'true' : 'false'"
              :data-visit="visit.id"
              @dragstart="onDragStart($event, visit, technician.id)"
            >
              <strong>{{ time(visit.startsAt) }}–{{ time(visit.endsAt) }}</strong>
              <Link route="jobs.show" :params="{ id: visit.job.id }" class="il">{{
                visit.job.number
              }}</Link>
              <span>{{ visit.job.customer }}</span>
              <span v-if="visit.job.site" class="field__hint">{{ visit.job.site }}</span>
            </div>
          </div>
        </div>
      </div>

      <table v-else class="table agenda--week">
        <thead>
          <tr>
            <th />
            <th v-for="day in days" :key="day">
              {{ weekday(day) }} {{ formatDate(day).slice(0, 5) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="technician in technicians" :key="technician.id">
            <th>
              {{ technician.name }}
              <span v-if="!technician.active" class="field__hint">{{
                t('ui.visits.inactive')
              }}</span>
            </th>
            <td
              v-for="day in days"
              :key="day"
              class="agenda__cell"
              :data-technician="technician.id"
              :data-day="day"
              @dragover.prevent
              @drop.prevent="onWeekDrop(technician.id, day)"
            >
              <div
                v-for="visit in visitsFor(technician.id, day)"
                :key="visit.id"
                class="agenda__visit agenda__visit--card"
                :class="`agenda__visit--${visit.status}`"
                :draggable="isOpen(visit) ? 'true' : 'false'"
                :data-visit="visit.id"
                @dragstart="onDragStart($event, visit, technician.id)"
              >
                <strong>{{ time(visit.startsAt) }}</strong>
                <Link route="jobs.show" :params="{ id: visit.job.id }" class="il">{{
                  visit.job.number
                }}</Link>
                <span>{{ visit.job.customer }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </Page>
  </AppLayout>
</template>
