<script setup lang="ts">
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import Pagination from '~/components/pagination.vue'
import JobList, { type JobRow } from '~/components/job_list.vue'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import { JOB_FILTERS } from '@shared/jobs'

const props = defineProps<{
  q: string
  status: string
  customer: { id: number; displayName: string } | null
  site: { id: number; summary: string } | null
  jobs: JobRow[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()

const search = ref(props.q)
const status = ref(props.status)

function submitSearch() {
  router.get(
    urlFor('jobs.index'),
    {
      ...(search.value && { q: search.value }),
      ...(status.value !== 'active' && { status: status.value }),
      ...(props.customer && { customerId: props.customer.id }),
      ...(props.site && { siteId: props.site.id }),
    },
    { preserveState: true, replace: true }
  )
}
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.jobs.title')">
      <template #actions>
        <Link route="jobs.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> {{ t('ui.jobs.new') }}
        </Link>
      </template>

      <form
        role="search"
        :style="{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }"
        @submit.prevent="submitSearch"
      >
        <input
          v-model="search"
          type="search"
          class="field__input"
          :aria-label="t('ui.jobs.searchLabel')"
          :placeholder="t('ui.jobs.searchPlaceholder')"
          :style="{ maxWidth: '320px' }"
        />
        <select
          v-model="status"
          class="field__input"
          :aria-label="t('ui.jobs.statusFilter')"
          :style="{ maxWidth: '200px' }"
          @change="submitSearch"
        >
          <option v-for="value in JOB_FILTERS" :key="value" :value="value">
            {{ t(`ui.jobs.filters.${value}`) }}
          </option>
        </select>
        <button type="submit" class="btn btn--secondary">{{ t('ui.common.search') }}</button>
      </form>

      <p v-if="customer || site" data-testid="jobs-owner-filter">
        <template v-if="customer">
          {{ t('ui.jobs.ofCustomer') }}
          <Link route="customers.show" :params="{ id: customer.id }">{{
            customer.displayName
          }}</Link>
        </template>
        <template v-if="site">
          {{ t('ui.jobs.ofSite') }}
          <Link route="sites.show" :params="{ id: site.id }">{{ site.summary }}</Link>
        </template>
        ·
        <Link route="jobs.index">{{ t('ui.jobs.clearOwnerFilter') }}</Link>
      </p>

      <p v-if="jobs.length === 0" :style="{ color: 'var(--subtle)' }">{{ t('ui.jobs.empty') }}</p>
      <JobList v-else :jobs="jobs" />

      <Pagination v-bind="pagination" />
    </Page>
  </AppLayout>
</template>
