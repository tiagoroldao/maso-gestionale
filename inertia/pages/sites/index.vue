<script setup lang="ts">
/**
 * Immobili, a List screen (docs/ui.md "Lists"): searched by address or
 * label, the archived ones a link away.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import type { ScreenAction } from '@shared/screen_actions'
import AppLayout from '~/layouts/app.vue'
import ListScreen from '~/components/screen/list_screen.vue'
import ListSearch from '~/components/screen/list_search.vue'
import { LINK, OPENS_LINK, OPENS_ROW, ROW, TD, TH } from '~/components/screen/screen'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'

const props = defineProps<{
  // New Site; the archived ones, or the active ones again
  actions: ScreenAction[]
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
    { preserveState: true, replace: true }
  )
}
</script>

<template>
  <AppLayout>
    <ListScreen
      :title="t('ui.sites.title')"
      :actions="actions"
      :description="t('ui.sites.description')"
      :empty="sites.length ? null : q ? t('ui.sites.noMatches', { q }) : t('ui.sites.empty')"
      :pagination="pagination"
    >
      <template #toolbar>
        <ListSearch
          v-model="search"
          :label="t('ui.sites.searchLabel')"
          :placeholder="t('ui.sites.searchPlaceholder')"
          @search="submitSearch"
        />
      </template>

      <div class="hidden overflow-x-auto md:block">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th :class="TH">{{ t('ui.sites.site') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.sites.customers') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="site in sites" :key="site.id" :class="OPENS_ROW">
              <td :class="TD">
                <Link route="sites.show" :params="{ id: site.id }" :class="cn(LINK, OPENS_LINK)">
                  {{ site.summary }}
                </Link>
              </td>
              <td :class="cn(TD, 'text-right')">{{ site.customerCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="m-0 list-none p-0 md:hidden">
        <li v-for="site in sites" :key="site.id" :class="cn(ROW, OPENS_ROW)">
          <Link
            route="sites.show"
            :params="{ id: site.id }"
            :class="cn(LINK, OPENS_LINK, 'min-w-0 flex-1 text-[15px] font-semibold')"
          >
            {{ site.summary }}
          </Link>
          <span class="shrink-0 text-[13px] text-muted-foreground">
            {{ t('ui.sites.customerCount', { count: site.customerCount }) }}
          </span>
        </li>
      </ul>
    </ListScreen>
  </AppLayout>
</template>
