<script setup lang="ts">
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
  technicians: { id: number; name: string }[]
  visits: CalendarVisit[]
}>()

/**
 * The day grid runs 07:00–20:00 in half-hour slots.
 */
const FIRST_HOUR = 7
const LAST_HOUR = 20
const SLOT_MINUTES = 30
const SLOT_HEIGHT = 24
const slots = Array.from(
  { length: ((LAST_HOUR - FIRST_HOUR) * 60) / SLOT_MINUTES },
  (_, i) => FIRST_HOUR * 60 + i * SLOT_MINUTES
)

const time = (iso: string) => iso.slice(11, 16)
const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))
const pad = (n: number) => String(n).padStart(2, '0')
const label = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

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

function blockStyle(visit: CalendarVisit) {
  const top = ((minutesOf(visit.startsAt) - FIRST_HOUR * 60) / SLOT_MINUTES) * SLOT_HEIGHT
  const height =
    ((minutesOf(visit.endsAt) - minutesOf(visit.startsAt)) / SLOT_MINUTES) * SLOT_HEIGHT
  return { top: `${Math.max(top, 0)}px`, height: `${Math.max(height, SLOT_HEIGHT)}px` }
}

const dragging = ref<{ visitId: number; fromTechnicianId: number; startsAt: string } | null>(null)

function onDragStart(visit: CalendarVisit, technicianId: number) {
  dragging.value = { visitId: visit.id, fromTechnicianId: technicianId, startsAt: visit.startsAt }
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
 * Day view: the drop position picks the half-hour slot.
 */
function onDayDrop(event: DragEvent, technicianId: number) {
  const column = event.currentTarget as HTMLElement
  const offset = event.clientY - column.getBoundingClientRect().top
  const slot = Math.max(0, Math.min(slots.length - 1, Math.floor(offset / SLOT_HEIGHT)))
  moveTo(technicianId, `${props.date}T${label(slots[slot])}`)
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
          <div class="agenda__header">{{ technician.name }}</div>
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
              :style="blockStyle(visit)"
              draggable="true"
              :data-visit="visit.id"
              @dragstart="onDragStart(visit, technician.id)"
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
            <th>{{ technician.name }}</th>
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
                draggable="true"
                :data-visit="visit.id"
                @dragstart="onDragStart(visit, technician.id)"
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
