<script setup lang="ts">
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import Pagination from '~/components/pagination.vue'
import { urlFor } from '~/client'
import { formatUnitPrice, t } from '~/i18n'
import { amountForInput } from '@shared/money'

const props = defineProps<{
  q: string
  archived: boolean
  items: {
    id: number
    code: string
    description: string
    unit: string
    stock: string
    category: string | null
    purchasePrice: string
    resalePrice: string
  }[]
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
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.items.title')">
      <template #actions>
        <Link
          route="items.index"
          :qs="archived ? {} : { archived: 'true' }"
          class="btn btn--ghost btn--sm"
        >
          {{ archived ? t('ui.items.hideArchived') : t('ui.items.showArchived') }}
        </Link>
        <Link route="items.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> {{ t('ui.items.new') }}
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
          :aria-label="t('ui.items.searchLabel')"
          :placeholder="t('ui.items.searchPlaceholder')"
          :style="{ maxWidth: '360px' }"
        />
        <button type="submit" class="btn btn--secondary">{{ t('ui.common.search') }}</button>
      </form>

      <p v-if="items.length === 0" :style="{ color: 'var(--subtle)' }">
        {{ q ? t('ui.items.noMatches', { q }) : t('ui.items.empty') }}
      </p>

      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('ui.items.code') }}</th>
            <th>{{ t('ui.items.description') }}</th>
            <th>{{ t('ui.items.category') }}</th>
            <th :style="{ textAlign: 'right' }">{{ t('ui.items.stock') }}</th>
            <th :style="{ textAlign: 'right' }">{{ t('ui.items.purchasePrice') }}</th>
            <th :style="{ textAlign: 'right' }">{{ t('ui.items.resalePrice') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td class="mono">
              <Link route="items.show" :params="{ id: item.id }" class="il">{{ item.code }}</Link>
            </td>
            <td>{{ item.description }}</td>
            <td>{{ item.category }}</td>
            <td :style="{ textAlign: 'right' }">
              {{ amountForInput(item.stock).replace(/,?0+$/, '').replace(/,$/, '') }}
              {{ item.unit }}
            </td>
            <td :style="{ textAlign: 'right' }">
              {{ formatUnitPrice(item.purchasePrice) }}/{{ item.unit }}
            </td>
            <td :style="{ textAlign: 'right' }">
              {{ formatUnitPrice(item.resalePrice) }}/{{ item.unit }}
            </td>
            <td class="table__actions">
              <Link route="items.edit" :params="{ id: item.id }" class="btn btn--ghost btn--sm">
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
