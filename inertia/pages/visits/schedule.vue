<script setup lang="ts">
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, t, todayIso } from '~/i18n'
import {
  SLOT_MINUTES,
  gridHours,
  layout,
  onDay,
  span,
  startsOn,
  type Placement,
} from '@shared/agenda'

type CalendarVisit = {
  id: number
  startsAt: string
  endsAt: string
  status: string
  survey: boolean
  technicianIds: number[]
  // Open, on a Job that takes new work: the server refuses moving the rest
  movable: boolean
  job: { id: number; number: string; title: string; customer: string; site: string | null }
}

const props = defineProps<{
  view: 'day' | 'week'
  date: string
  from: string
  days: string[]
  technicians: { id: number; name: string; active: boolean }[]
  visits: CalendarVisit[]
  unassigned: {
    id: number
    startsAt: string
    endsAt: string
    status: string
    survey: boolean
    job: { number: string; customer: string }
  }[]
}>()

const SLOT_HEIGHT = 24

const time = (iso: string) => iso.slice(11, 16)
const pad = (n: number) => String(n).padStart(2, '0')
const label = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

const grid = computed(() => gridHours(props.visits, props.date))
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

/**
 * The week view lists a Visit on its start day only: dropping a card keeps
 * its start time on the new day.
 */
function visitsFor(technicianId: number, day: string) {
  return props.visits.filter(
    (visit) => visit.technicianIds.includes(technicianId) && visit.startsAt.slice(0, 10) === day
  )
}

/** The day view shows a Visit across midnight on both days. */
function visitsOn(technicianId: number) {
  return props.visits.filter(
    (visit) => visit.technicianIds.includes(technicianId) && onDay(visit, props.date)
  )
}

function blockStyle(visit: CalendarVisit, placement?: Placement) {
  const { start, end } = span(visit, props.date)
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
 * Closed Visits (done, or needing another visit), cancelled ones and a
 * closed Job's Visits can't move: the server refuses them too.
 */
function isOpen(visit: CalendarVisit) {
  return visit.movable
}

/**
 * Dragged only from the day it starts: on the next day a Visit across
 * midnight is cut at 00:00, and a drop there would move its start.
 */
function canDrag(visit: CalendarVisit, day: string) {
  return isOpen(visit) && startsOn(visit, day)
}

function onDragStart(event: DragEvent, visit: CalendarVisit, technicianId: number, day: string) {
  if (!canDrag(visit, day)) return
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

      <section v-if="unassigned.length" data-testid="unassigned" :style="{ marginBottom: '12px' }">
        <strong>{{ t('ui.visits.unassigned') }}</strong>
        <ul>
          <li v-for="visit in unassigned" :key="visit.id">
            <Link route="visits.edit" :params="{ id: visit.id }" class="il">
              {{ formatDate(visit.startsAt.slice(0, 10)) }} {{ time(visit.startsAt) }}–{{
                time(visit.endsAt)
              }}
              · {{ visit.job.number }} · {{ visit.job.customer }}
            </Link>
            <span v-if="visit.survey" class="tag">{{ t('ui.visits.survey') }}</span>
            <span v-if="visit.status === 'cancelled'" class="tag">{{
              t('ui.visits.statuses.cancelled')
            }}</span>
          </li>
        </ul>
      </section>

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
              v-for="visit in visitsOn(technician.id)"
              :key="visit.id"
              class="agenda__visit"
              :class="`agenda__visit--${visit.status}`"
              :style="blockStyle(visit, layout(visitsOn(technician.id), date).get(visit.id))"
              :draggable="canDrag(visit, date) ? 'true' : 'false'"
              :data-visit="visit.id"
              @dragstart="onDragStart($event, visit, technician.id, date)"
            >
              <strong>{{ time(visit.startsAt) }}–{{ time(visit.endsAt) }}</strong>
              <Link route="jobs.show" :params="{ id: visit.job.id }" class="il">{{
                visit.job.number
              }}</Link>
              <span>{{ visit.job.customer }}</span>
              <span v-if="visit.job.site" class="field__hint">{{ visit.job.site }}</span>
              <span v-if="visit.survey" class="tag">{{ t('ui.visits.survey') }}</span>
              <span v-if="visit.status === 'cancelled'" class="tag">{{
                t('ui.visits.statuses.cancelled')
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <table v-else class="agenda--week table">
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
                :draggable="canDrag(visit, day) ? 'true' : 'false'"
                :data-visit="visit.id"
                @dragstart="onDragStart($event, visit, technician.id, day)"
              >
                <strong>{{ time(visit.startsAt) }}</strong>
                <Link route="jobs.show" :params="{ id: visit.job.id }" class="il">{{
                  visit.job.number
                }}</Link>
                <span>{{ visit.job.customer }}</span>
                <span v-if="visit.survey" class="tag">{{ t('ui.visits.survey') }}</span>
                <span v-if="visit.status === 'cancelled'" class="tag">{{
                  t('ui.visits.statuses.cancelled')
                }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </Page>
  </AppLayout>
</template>
