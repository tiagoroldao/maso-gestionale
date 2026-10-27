<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, t } from '~/i18n'

defineProps<{
  visits: {
    id: number
    startsAt: string
    technicians: string[]
    lastNote: string | null
    job: { id: number; number: string; title: string; customer: string; site: string | null }
  }[]
}>()
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.toSchedule.title')" :description="t('ui.toSchedule.description')">
      <p v-if="visits.length === 0" :style="{ color: 'var(--subtle)' }">
        {{ t('ui.toSchedule.none') }}
      </p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('ui.jobs.number') }}</th>
            <th>{{ t('ui.jobs.customer') }}</th>
            <th>{{ t('ui.toSchedule.lastVisit') }}</th>
            <th>{{ t('ui.toSchedule.lastNote') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="visit in visits" :key="visit.id">
            <td class="mono">
              <Link route="jobs.show" :params="{ id: visit.job.id }" class="il">
                {{ visit.job.number }}
              </Link>
            </td>
            <td>
              {{ visit.job.customer }}
              <span v-if="visit.job.site" class="field__hint"> · {{ visit.job.site }}</span>
            </td>
            <td>{{ formatDate(visit.startsAt) }} · {{ visit.technicians.join(', ') }}</td>
            <td>{{ visit.lastNote }}</td>
            <td class="table__actions">
              <Link
                route="visits.create"
                :params="{ id: visit.job.id }"
                class="btn btn--secondary btn--sm"
              >
                {{ t('ui.visits.plan') }}
              </Link>
            </td>
          </tr>
        </tbody>
      </table>
    </Page>
  </AppLayout>
</template>
