<script setup lang="ts">
/**
 * Commesse, a List screen (docs/ui.md "Lists"): searched by number, title
 * or Customer, filtered by status, or narrowed to a Customer's or a Site's
 * Jobs from their pages.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import type { ScreenAction } from '@shared/screen_actions'
import AppLayout from '~/layouts/app.vue'
import ListScreen from '~/components/screen/list_screen.vue'
import ListSearch from '~/components/screen/list_search.vue'
import JobRows, { type JobRow } from '~/components/screen/job_rows.vue'
import { NativeSelect } from '~/components/ui/native-select'
import { LINK } from '~/components/screen/screen'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import { JOB_FILTERS } from '@shared/jobs'

const props = defineProps<{
  // New Job
  actions: ScreenAction[]
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
    <ListScreen
      :title="t('ui.jobs.title')"
      :actions="actions"
      :empty="jobs.length ? null : t('ui.jobs.empty')"
      :pagination="pagination"
    >
      <template #toolbar>
        <ListSearch
          v-model="search"
          :label="t('ui.jobs.searchLabel')"
          :placeholder="t('ui.jobs.searchPlaceholder')"
          @search="submitSearch"
        >
          <NativeSelect
            v-model="status"
            :aria-label="t('ui.jobs.statusFilter')"
            class="flex-[1_1_180px] md:w-52 md:flex-none"
            @change="submitSearch"
          >
            <option v-for="value in JOB_FILTERS" :key="value" :value="value">
              {{ t(`ui.jobs.filters.${value}`) }}
            </option>
          </NativeSelect>
        </ListSearch>
        <p v-if="customer || site" class="m-0 text-sm" data-testid="jobs-owner-filter">
          <template v-if="customer">
            {{ t('ui.jobs.ofCustomer') }}
            <Link route="customers.show" :params="{ id: customer.id }" :class="LINK">
              {{ customer.displayName }}
            </Link>
          </template>
          <template v-if="site">
            {{ t('ui.jobs.ofSite') }}
            <Link route="sites.show" :params="{ id: site.id }" :class="LINK">
              {{ site.summary }}
            </Link>
          </template>
          ·
          <Link route="jobs.index" :class="LINK">{{ t('ui.jobs.clearOwnerFilter') }}</Link>
        </p>
      </template>

      <JobRows :jobs="jobs" show-customer show-site />
    </ListScreen>
  </AppLayout>
</template>
