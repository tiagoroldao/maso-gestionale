<script setup lang="ts">
import { computed, ref } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, t, todayIso } from '~/i18n'
import { formatDateTime } from '@shared/dates'
import { REPEAT_FREQUENCIES, WEEKDAYS } from '@shared/visit_repeats'

const props = defineProps<{
  job: { id: number; number: string; title: string; customer: string }
  technicians: { id: number; name: string; active: boolean }[]
  /** Set when editing an existing Visit */
  visit: {
    id: number
    date: string
    startTime: string
    durationMinutes: number
    technicianIds: number[]
    notes: string | null
    survey: boolean
    status: string
    started: { at: string; by: string | null } | null
    closed: { at: string; by: string | null } | null
    editable: boolean
    closableByOffice: boolean
    cancellable: boolean
    restorable: boolean
    plannable: boolean
  } | null
  /** What a new Visit starts from: a copied Visit, or a repeat asked for (#177) */
  draft: {
    date: string
    startTime: string
    durationMinutes: number
    technicianIds: number[]
    notes: string | null
    survey: boolean
    repeat: string | null
    weekdays: number[]
    until: string | null
    count: number | null
  } | null
  /** The dates a repeated Visit falls on, for Office to confirm (#177) */
  preview: {
    startTime: string
    durationMinutes: number
    technicianIds: number[]
    notes: string | null
    survey: boolean
    truncated: boolean
    dates: { date: string; weekday: number; holiday: string | null; clashes: string[] }[]
  } | null
  maxRepeated: number
}>()

const values = props.visit ?? props.draft
// Bound to the inputs, so showing or hiding the repeat fields keeps what
// was typed
const date = ref(values?.date ?? todayIso())
const startTime = ref(values?.startTime ?? '08:30')
const durationMinutes = ref(values?.durationMinutes ?? 120)
const survey = ref(values?.survey ?? false)
const technicianIds = ref([...(values?.technicianIds ?? [])])
const notes = ref(values?.notes ?? '')
const weekdays = ref([...(props.draft?.weekdays ?? [])])
const until = ref(props.draft?.until ?? '')
const count = ref(props.draft?.count ?? '')
// The Visit's own length stays selectable even if it isn't a usual one
const durations = [...new Set([30, 60, 90, 120, 180, 240, 480, durationMinutes.value])].sort(
  (a, b) => a - b
)
const repeat = ref(props.draft?.repeat ?? 'none')
const repeating = computed(() => !props.visit && repeat.value !== 'none')
// Repeating first lists the dates (the same page, with the repeat in the
// query); otherwise the Visit is planned or saved straight away
const action = computed(() => {
  if (props.visit) {
    return { url: urlFor('visits.update', { id: props.visit.id }), method: 'put' as const }
  }
  if (repeating.value) {
    return { url: urlFor('visits.create', { id: props.job.id }), method: 'get' as const }
  }
  return { url: urlFor('visits.store', { id: props.job.id }), method: 'post' as const }
})
const confirmDelete = () => window.confirm(t('ui.visits.deleteConfirm'))
const confirmDone = () => window.confirm(t('ui.visits.markDoneConfirm'))
const confirmCancel = () => window.confirm(t('ui.visits.cancelConfirm'))
</script>

<template>
  <AppLayout>
    <Page
      :title="
        visit
          ? t('ui.visits.editTitle', { number: job.number })
          : t('ui.visits.planTitle', { number: job.number })
      "
      :description="`${job.title} · ${job.customer}`"
    >
      <p v-if="visit?.started" class="field__hint" data-testid="visit-started">
        {{
          visit.started.by
            ? t('ui.visits.startedBy', {
                at: formatDateTime(visit.started.at),
                by: visit.started.by,
              })
            : t('ui.visits.started', { at: formatDateTime(visit.started.at) })
        }}
      </p>
      <p v-if="visit?.closed" class="field__hint" data-testid="visit-closed">
        {{
          visit.closed.by
            ? t('ui.visits.closedBy', { at: formatDateTime(visit.closed.at), by: visit.closed.by })
            : t('ui.visits.closed', { at: formatDateTime(visit.closed.at) })
        }}
      </p>
      <Section v-if="visit?.closableByOffice">
        <p class="field__hint">{{ t('ui.visits.frozenHint') }}</p>
        <Form route="visits.mark_done" :params="{ id: visit.id }" :on-before="confirmDone">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.visits.markDone') }}
          </button>
        </Form>
      </Section>
      <Section v-else-if="visit?.status === 'cancelled'">
        <p class="field__hint">{{ t('ui.visits.cancelledHint') }}</p>
        <Form v-if="visit.restorable" route="visits.restore" :params="{ id: visit.id }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.visits.restore') }}
          </button>
        </Form>
      </Section>
      <p v-else-if="visit && !visit.editable" class="field__hint">
        {{ t('ui.visits.closedHint') }}
      </p>
      <Form v-slot="{ processing, errors }" :action="action">
        <Section :title="t('ui.visits.when')">
          <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
            <div class="field">
              <label class="field__label" for="date">{{ t('ui.visits.date') }}</label>
              <input id="date" v-model="date" name="date" type="date" class="field__input" />
              <span v-if="errors.date" class="field__error">{{ errors.date }}</span>
            </div>
            <div class="field">
              <label class="field__label" for="startTime">{{ t('ui.visits.startTime') }}</label>
              <input
                id="startTime"
                v-model="startTime"
                name="startTime"
                type="time"
                step="900"
                class="field__input"
              />
              <span v-if="errors.startTime" class="field__error">{{ errors.startTime }}</span>
            </div>
            <div class="field">
              <label class="field__label" for="durationMinutes">{{
                t('ui.visits.duration')
              }}</label>
              <select
                id="durationMinutes"
                v-model="durationMinutes"
                name="durationMinutes"
                class="field__input"
              >
                <option v-for="minutes in durations" :key="minutes" :value="minutes">
                  {{
                    minutes < 60
                      ? t('ui.visits.minutes', { minutes })
                      : t('ui.visits.hours', { hours: minutes / 60 })
                  }}
                </option>
              </select>
            </div>
          </div>
        </Section>

        <Section v-if="!visit">
          <div class="field">
            <label class="field__label" for="repeat">{{ t('ui.visits.repeat') }}</label>
            <select id="repeat" v-model="repeat" name="repeat" class="field__input">
              <option value="none">{{ t('ui.visits.repeats.none') }}</option>
              <option v-for="frequency in REPEAT_FREQUENCIES" :key="frequency" :value="frequency">
                {{ t(`ui.visits.repeats.${frequency}`) }}
              </option>
            </select>
            <span v-if="errors.repeat" class="field__error">{{ errors.repeat }}</span>
          </div>
          <template v-if="repeating">
            <fieldset v-if="repeat === 'days'" class="field">
              <legend class="field__label">{{ t('ui.visits.weekdays') }}</legend>
              <label
                v-for="weekday in WEEKDAYS"
                :key="weekday"
                :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
              >
                <input v-model="weekdays" type="checkbox" name="weekdays[]" :value="weekday" />
                {{ t(`ui.visits.weekdayNames.${weekday}`) }}
              </label>
              <span v-if="errors.weekdays" class="field__error">{{ errors.weekdays }}</span>
            </fieldset>
            <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
              <div class="field">
                <label class="field__label" for="until">{{ t('ui.visits.until') }}</label>
                <input id="until" v-model="until" name="until" type="date" class="field__input" />
                <span v-if="errors.until" class="field__error">{{ errors.until }}</span>
              </div>
              <div class="field">
                <label class="field__label" for="count">{{ t('ui.visits.count') }}</label>
                <input
                  id="count"
                  v-model="count"
                  name="count"
                  type="number"
                  min="1"
                  :max="maxRepeated"
                  class="field__input"
                />
                <span v-if="errors.count" class="field__error">{{ errors.count }}</span>
              </div>
            </div>
            <p class="field__hint">{{ t('ui.visits.untilOrCount', { max: maxRepeated }) }}</p>
            <p class="field__hint">{{ t('ui.visits.repeatHint') }}</p>
          </template>
        </Section>

        <Section>
          <div class="field">
            <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
              <input v-model="survey" type="checkbox" name="survey" value="true" />
              {{ t('ui.visits.survey') }}
            </label>
            <span class="field__hint">{{ t('ui.visits.surveyHint') }}</span>
          </div>
        </Section>

        <Section :title="t('ui.visits.technicians')">
          <p v-if="technicians.length === 0" class="field__hint">
            {{ t('ui.visits.noTechnicians') }}
          </p>
          <label
            v-for="technician in technicians"
            :key="technician.id"
            :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
          >
            <input
              v-model="technicianIds"
              type="checkbox"
              name="technicianIds[]"
              :value="technician.id"
            />
            {{ technician.name }}
            <span v-if="!technician.active" class="field__hint">{{ t('ui.visits.inactive') }}</span>
          </label>
          <span v-if="errors.technicianIds" class="field__error">{{ errors.technicianIds }}</span>
        </Section>

        <Section :title="t('ui.visits.notes')">
          <textarea
            v-model="notes"
            name="notes"
            class="field__input"
            rows="3"
            :aria-label="t('ui.visits.notes')"
            :placeholder="t('ui.visits.notesHint')"
          />
        </Section>

        <Section>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing || (visit !== null && !visit.editable)"
          >
            {{
              visit
                ? t('ui.visits.save')
                : repeating
                  ? t('ui.visits.showDates')
                  : t('ui.visits.plan')
            }}
          </button>
        </Section>
      </Form>

      <Form
        v-if="preview"
        v-slot="{ processing, errors }"
        route="visits.store_repeated"
        :params="{ id: job.id }"
      >
        <Section :title="t('ui.visits.datesTitle')">
          <input type="hidden" name="startTime" :value="preview.startTime" />
          <input type="hidden" name="durationMinutes" :value="preview.durationMinutes" />
          <input
            v-for="id in preview.technicianIds"
            :key="id"
            type="hidden"
            name="technicianIds[]"
            :value="id"
          />
          <input type="hidden" name="notes" :value="preview.notes ?? ''" />
          <input v-if="preview.survey" type="hidden" name="survey" value="true" />

          <p v-if="preview.dates.length === 0" class="field__hint">
            {{ t('ui.visits.noDates') }}
          </p>
          <template v-else>
            <p class="field__hint">{{ t('ui.visits.datesHint') }}</p>
            <table class="table">
              <tbody>
                <tr v-for="day in preview.dates" :key="day.date">
                  <td>
                    <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
                      <input type="checkbox" name="dates[]" :value="day.date" checked />
                      {{ t(`ui.visits.weekdayNames.${day.weekday}`) }}
                      {{ formatDate(day.date) }}
                    </label>
                  </td>
                  <td>
                    <span v-if="day.holiday">
                      {{ t('ui.visits.holiday', { name: t(`ui.visits.holidays.${day.holiday}`) }) }}
                    </span>
                  </td>
                  <td>
                    <span v-if="day.clashes.length" class="field__error">
                      {{ t('ui.visits.clash', { names: day.clashes.join(', ') }) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="preview.truncated" class="field__hint">
              {{ t('ui.visits.truncated', { max: maxRepeated }) }}
            </p>
            <span v-if="errors.dates" class="field__error">{{ errors.dates }}</span>
          </template>
        </Section>
        <Section v-if="preview.dates.length">
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.visits.planDates') }}
          </button>
        </Section>
      </Form>

      <Section v-if="visit?.plannable">
        <Link
          route="visits.create"
          :params="{ id: job.id }"
          :qs="{ from: visit.id }"
          class="btn btn--secondary btn--sm"
        >
          {{ t('ui.visits.planNext') }}
        </Link>
        <span class="field__hint">{{ t('ui.visits.planNextHint') }}</span>
      </Section>
      <Section v-if="visit?.editable">
        <Form route="visits.destroy" :params="{ id: visit.id }" :on-before="confirmDelete">
          <button type="submit" class="btn btn--ghost btn--sm">
            <Trash2 :size="14" /> {{ t('ui.visits.delete') }}
          </button>
        </Form>
        <span class="field__hint">{{ t('ui.visits.deleteHint') }}</span>
      </Section>
      <Section v-if="visit?.cancellable">
        <Form route="visits.cancel" :params="{ id: visit.id }" :on-before="confirmCancel">
          <button type="submit" class="btn btn--ghost btn--sm">
            {{ t('ui.visits.cancel') }}
          </button>
        </Form>
      </Section>
    </Page>
  </AppLayout>
</template>
