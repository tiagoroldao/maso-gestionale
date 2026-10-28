<script setup lang="ts">
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import Pagination from '~/components/pagination.vue'
import { urlFor } from '~/client'
import { t } from '~/i18n'

const props = defineProps<{
  q: string
  archived: boolean
  sites: { id: number; summary: string; customerCount: number }[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()

const search = ref(props.q)

function submitSearch() {
  router.get(
    urlFor('sites.index'),
    { ...(search.value && { q: search.value }), ...(props.archived && { archived: 'true' }) },
    {
      preserveState: true,
      replace: true,
    }
  )
}
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.sites.title')" :description="t('ui.sites.description')">
      <template #actions>
        <Link
          route="sites.index"
          :qs="archived ? {} : { archived: 'true' }"
          class="btn btn--ghost btn--sm"
        >
          {{ archived ? t('ui.archive.hideArchived') : t('ui.archive.showArchived') }}
        </Link>
        <Link route="sites.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> {{ t('ui.sites.new') }}
        </Link>
      </template>

      <form
        role="search"
        :style="{ display: 'flex', gap: '8px', marginBottom: '16px' }"
        @submit.prevent="submitSearch"
      >
        <input
          v-model="search"
          type="search"
          class="field__input"
          :aria-label="t('ui.sites.searchLabel')"
          :placeholder="t('ui.sites.searchPlaceholder')"
          :style="{ maxWidth: '360px' }"
        />
        <button type="submit" class="btn btn--secondary">{{ t('ui.common.search') }}</button>
      </form>

      <p v-if="sites.length === 0" :style="{ color: 'var(--subtle)' }">
        {{ q ? t('ui.sites.noMatches', { q }) : t('ui.sites.empty') }}
      </p>

      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('ui.sites.site') }}</th>
            <th>{{ t('ui.sites.customers') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="site in sites" :key="site.id">
            <td>
              <Link route="sites.show" :params="{ id: site.id }" class="il">
                {{ site.summary }}
              </Link>
            </td>
            <td>{{ site.customerCount }}</td>
            <td class="table__actions">
              <Link route="sites.edit" :params="{ id: site.id }" class="btn btn--ghost btn--sm">
                {{ t('ui.common.edit') }}
              </Link>
            </td>
          </tr>
        </tbody>
      </table>

      <Pagination v-bind="pagination" />
    </Page>
  </AppLayout>
</template>
