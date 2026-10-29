<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import { Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { t, todayIso } from '~/i18n'

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
    editable: boolean
    closableByOffice: boolean
    cancellable: boolean
    restorable: boolean
  } | null
}>()

const durationMinutes = props.visit?.durationMinutes ?? 120
// The Visit's own length stays selectable even if it isn't a usual one
const durations = [...new Set([30, 60, 90, 120, 180, 240, 480, durationMinutes])].sort(
  (a, b) => a - b
)
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
      <Form
        v-slot="{ processing, errors }"
        :route="visit ? 'visits.update' : 'visits.store'"
        :params="{ id: visit ? visit.id : job.id }"
      >
        <Section :title="t('ui.visits.when')">
          <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
            <div class="field">
              <label class="field__label" for="date">{{ t('ui.visits.date') }}</label>
              <input
                id="date"
                name="date"
                type="date"
                class="field__input"
                :value="visit?.date ?? todayIso()"
              />
              <span v-if="errors.date" class="field__error">{{ errors.date }}</span>
            </div>
            <div class="field">
              <label class="field__label" for="startTime">{{ t('ui.visits.startTime') }}</label>
              <input
                id="startTime"
                name="startTime"
                type="time"
                step="900"
                class="field__input"
                :value="visit?.startTime ?? '08:30'"
              />
              <span v-if="errors.startTime" class="field__error">{{ errors.startTime }}</span>
            </div>
            <div class="field">
              <label class="field__label" for="durationMinutes">{{
                t('ui.visits.duration')
              }}</label>
              <select id="durationMinutes" name="durationMinutes" class="field__input">
                <option
                  v-for="minutes in durations"
                  :key="minutes"
                  :value="minutes"
                  :selected="minutes === durationMinutes"
                >
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

        <Section>
          <div class="field">
            <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
              <input type="checkbox" name="survey" value="true" :checked="visit?.survey" />
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
              type="checkbox"
              name="technicianIds[]"
              :value="technician.id"
              :checked="visit?.technicianIds.includes(technician.id)"
            />
            {{ technician.name }}
            <span v-if="!technician.active" class="field__hint">{{ t('ui.visits.inactive') }}</span>
          </label>
          <span v-if="errors.technicianIds" class="field__error">{{ errors.technicianIds }}</span>
        </Section>

        <Section :title="t('ui.visits.notes')">
          <textarea
            name="notes"
            class="field__input"
            rows="3"
            :aria-label="t('ui.visits.notes')"
            :placeholder="t('ui.visits.notesHint')"
            :value="visit?.notes ?? ''"
          />
        </Section>

        <Section>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing || (visit !== null && !visit.editable)"
          >
            {{ visit ? t('ui.visits.save') : t('ui.visits.plan') }}
          </button>
        </Section>
      </Form>
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
