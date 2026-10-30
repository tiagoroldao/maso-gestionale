<script setup lang="ts">
/**
 * Articoli, a List screen (docs/ui.md "Lists"): searched by code,
 * description or supplier code, the archived ones a link away. The table
 * is wide: on a tablet it scrolls inside its box.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import type { ScreenAction } from '@shared/screen_actions'
import { formatQuantity } from '@shared/stock'
import AppLayout from '~/layouts/app.vue'
import ListScreen from '~/components/screen/list_screen.vue'
import ListSearch from '~/components/screen/list_search.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import { LINK, OPENS_LINK, OPENS_ROW, ROW, TD, TH } from '~/components/screen/screen'
import { urlFor } from '~/client'
import { formatUnitPrice, t } from '~/i18n'
import { cn } from '~/lib/utils'

type Item = {
  id: number
  code: string
  description: string
  unit: string
  inStock: string
  committed: string
  available: string
  category: string | null
  equipment: boolean
  groupable: boolean
  purchasePrice: string
  resalePrice: string
}

const props = defineProps<{
  // New Item; the archived ones, or the active ones again
  actions: ScreenAction[]
  q: string
  archived: boolean
  items: Item[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()

const search = ref(props.q)

function submitSearch() {
  router.get(
    urlFor('items.index'),
    { ...(search.value && { q: search.value }), ...(props.archived && { archived: 'true' }) },
    { preserveState: true, replace: true }
  )
}

const withUnit = (value: string, unit: string) => `${formatQuantity(value)} ${unit}`
const perUnit = (price: string, unit: string) => `${formatUnitPrice(price)}/${unit}`
const NUMBER = cn(TD, 'text-right whitespace-nowrap')
</script>

<template>
  <AppLayout>
    <ListScreen
      :title="t('ui.items.title')"
      :actions="actions"
      :empty="items.length ? null : q ? t('ui.items.noMatches', { q }) : t('ui.items.empty')"
      :pagination="pagination"
    >
      <template #toolbar>
        <ListSearch
          v-model="search"
          :label="t('ui.items.searchLabel')"
          :placeholder="t('ui.items.searchPlaceholder')"
          @search="submitSearch"
        />
      </template>

      <div class="hidden overflow-x-auto md:block">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th :class="TH">{{ t('ui.items.code') }}</th>
              <th :class="TH">{{ t('ui.items.description') }}</th>
              <th :class="TH">{{ t('ui.items.category') }}</th>
              <th :class="TH">{{ t('ui.items.flags') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.items.stock') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.items.committed') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.items.available') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.items.purchasePrice') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.items.resalePrice') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" :class="OPENS_ROW">
              <td :class="cn(TD, 'font-mono whitespace-nowrap')">
                <Link route="items.show" :params="{ id: item.id }" :class="cn(LINK, OPENS_LINK)">
                  {{ item.code }}
                </Link>
              </td>
              <td :class="TD">{{ item.description }}</td>
              <td :class="TD">{{ item.category }}</td>
              <td :class="TD">
                <span class="flex flex-wrap gap-1.5">
                  <StatusTag v-if="item.equipment" tone="grey">
                    {{ t('ui.items.equipment') }}
                  </StatusTag>
                  <StatusTag v-if="item.groupable" tone="grey">
                    {{ t('ui.items.groupable') }}
                  </StatusTag>
                </span>
              </td>
              <td :class="NUMBER">{{ withUnit(item.inStock, item.unit) }}</td>
              <td :class="NUMBER">{{ withUnit(item.committed, item.unit) }}</td>
              <td :class="NUMBER">{{ withUnit(item.available, item.unit) }}</td>
              <td :class="NUMBER">{{ perUnit(item.purchasePrice, item.unit) }}</td>
              <td :class="NUMBER">{{ perUnit(item.resalePrice, item.unit) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="m-0 list-none p-0 md:hidden">
        <li v-for="item in items" :key="item.id" :class="cn(ROW, OPENS_ROW)">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <Link
              route="items.show"
              :params="{ id: item.id }"
              :class="cn(LINK, OPENS_LINK, 'text-[15px] font-semibold')"
            >
              {{ item.description }}
            </Link>
            <span class="text-[13px] text-muted-foreground">
              {{
                [
                  item.code,
                  item.category,
                  `${t('ui.items.stock')} ${withUnit(item.inStock, item.unit)}`,
                  `${t('ui.items.committed')} ${withUnit(item.committed, item.unit)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              }}
            </span>
            <span v-if="item.equipment || item.groupable" class="flex flex-wrap gap-1.5">
              <StatusTag v-if="item.equipment" tone="grey">{{ t('ui.items.equipment') }}</StatusTag>
              <StatusTag v-if="item.groupable" tone="grey">{{ t('ui.items.groupable') }}</StatusTag>
            </span>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-0.5 text-right">
            <span class="text-[15px] font-semibold">
              {{ withUnit(item.available, item.unit) }}
            </span>
            <span class="text-[13px] text-muted-foreground">
              {{ perUnit(item.resalePrice, item.unit) }}
            </span>
          </div>
        </li>
      </ul>
    </ListScreen>
  </AppLayout>
</template>
