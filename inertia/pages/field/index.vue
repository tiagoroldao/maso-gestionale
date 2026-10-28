<script setup lang="ts">
import { computed } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, t, todayIso } from '~/i18n'

const props = defineProps<{
  visits: {
    id: number
    startsAt: string
    endsAt: string
    status: string
    survey: boolean
    job: { number: string; title: string }
    customer: string
    site: string | null
  }[]
}>()

const today = todayIso()
const days = computed(() => {
  const groups = new Map<string, typeof props.visits>()
  for (const visit of props.visits) {
    const day = visit.startsAt.slice(0, 10)
    groups.set(day, [...(groups.get(day) ?? []), visit])
  }
  return [...groups.entries()]
})
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.field.title')">
      <p v-if="visits.length === 0" :style="{ color: 'var(--subtle)' }">{{ t('ui.field.none') }}</p>
      <section v-for="[day, dayVisits] in days" :key="day" class="field-day">
        <h2 class="field-day__title">
          {{ day === today ? t('ui.field.today') : formatDate(day) }}
        </h2>
        <Link
          v-for="visit in dayVisits"
          :key="visit.id"
          route="my_visits.show"
          :params="{ id: visit.id }"
          class="field-card"
        >
          <span class="field-card__time">
            {{ visit.startsAt.slice(11, 16) }}–{{ visit.endsAt.slice(11, 16) }}
            <span v-if="visit.survey" class="tag">{{ t('ui.visits.survey') }}</span>
            <span class="tag">{{ t(`ui.visits.statuses.${visit.status}`) }}</span>
          </span>
          <strong>{{ visit.customer }}</strong>
          <span v-if="visit.site">{{ visit.site }}</span>
          <span class="field__hint">{{ visit.job.number }} · {{ visit.job.title }}</span>
        </Link>
      </section>
    </Page>
  </AppLayout>
</template>
