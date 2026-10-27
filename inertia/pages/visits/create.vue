<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { t, todayIso } from '~/i18n'

defineProps<{
  job: { id: number; number: string; title: string; customer: string }
  technicians: { id: number; name: string }[]
}>()

const durations = [30, 60, 90, 120, 180, 240, 480]
</script>

<template>
  <AppLayout>
    <Page
      :title="t('ui.visits.planTitle', { number: job.number })"
      :description="`${job.title} · ${job.customer}`"
    >
      <Form v-slot="{ processing, errors }" route="visits.store" :params="{ id: job.id }">
        <Section :title="t('ui.visits.when')">
          <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
            <div class="field">
              <label class="field__label" for="date">{{ t('ui.visits.date') }}</label>
              <input id="date" name="date" type="date" class="field__input" :value="todayIso()" />
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
                value="08:30"
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
                  :selected="minutes === 120"
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

        <Section :title="t('ui.visits.technicians')">
          <p v-if="technicians.length === 0" class="field__hint">
            {{ t('ui.visits.noTechnicians') }}
          </p>
          <label
            v-for="technician in technicians"
            :key="technician.id"
            :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
          >
            <input type="checkbox" name="technicianIds[]" :value="technician.id" />
            {{ technician.name }}
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
          />
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.visits.plan') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
