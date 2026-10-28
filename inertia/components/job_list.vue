<script setup lang="ts">
/**
 * Jobs in a table, as on the Jobs page and the Customer and Site pages.
 * Columns for the Customer or Site can be hidden where they are implied.
 */
import { Link } from '@adonisjs/inertia/vue'
import { formatDate, t } from '~/i18n'

export type JobRow = {
  id: number
  number: string
  title: string
  status: string
  customer: { id: number; displayName: string } | null
  site: { id: number; summary: string } | null
  createdAt: string
}

withDefaults(defineProps<{ jobs: JobRow[]; showCustomer?: boolean; showSite?: boolean }>(), {
  showCustomer: true,
  showSite: true,
})
</script>

<template>
  <table class="table">
    <thead>
      <tr>
        <th>{{ t('ui.jobs.number') }}</th>
        <th>{{ t('ui.jobs.jobTitle') }}</th>
        <th v-if="showCustomer">{{ t('ui.jobs.customer') }}</th>
        <th v-if="showSite">{{ t('ui.jobs.site') }}</th>
        <th>{{ t('ui.jobs.status') }}</th>
        <th>{{ t('ui.jobs.createdAt') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="job in jobs"
        :key="job.id"
        :class="{ 'table__row--muted': job.status === 'cancelled' }"
      >
        <td class="mono">
          <Link route="jobs.show" :params="{ id: job.id }" class="il">{{ job.number }}</Link>
        </td>
        <td>{{ job.title }}</td>
        <td v-if="showCustomer">{{ job.customer?.displayName }}</td>
        <td v-if="showSite">{{ job.site?.summary }}</td>
        <td>
          <span class="tag">{{ t(`ui.jobs.statuses.${job.status}`) }}</span>
        </td>
        <td>{{ formatDate(job.createdAt) }}</td>
      </tr>
    </tbody>
  </table>
</template>
