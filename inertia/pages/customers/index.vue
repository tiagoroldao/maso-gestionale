<script setup lang="ts">
/**
 * Clienti, a List screen (docs/ui.md "Lists"): searched by name or tax ID,
 * the archived ones a link away.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import type { ScreenAction } from '@shared/screen_actions'
import AppLayout from '~/layouts/app.vue'
import ListScreen from '~/components/screen/list_screen.vue'
import ListSearch from '~/components/screen/list_search.vue'
import { customerTypeLabel } from '~/components/customer_types'
import { LINK, OPENS_LINK, OPENS_ROW, ROW, TD, TH } from '~/components/screen/screen'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'

type Customer = {
  id: number
  displayName: string
  type: string
  vatNumber: string | null
  taxCode: string | null
  city: string
  province: string
}

const props = defineProps<{
  // New Customer; the archived ones, or the active ones again
  actions: ScreenAction[]
  q: string
  archived: boolean
  customers: Customer[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()

const search = ref(props.q)

function submitSearch() {
  router.get(
    urlFor('customers.index'),
    { ...(search.value && { q: search.value }), ...(props.archived && { archived: 'true' }) },
    { preserveState: true, replace: true }
  )
}

const taxId = (customer: Customer) => customer.vatNumber ?? customer.taxCode
const place = (customer: Customer) => `${customer.city} (${customer.province})`
</script>

<template>
  <AppLayout>
    <ListScreen
      :title="t('ui.customers.title')"
      :actions="actions"
      :empty="
        customers.length ? null : q ? t('ui.customers.noMatches', { q }) : t('ui.customers.empty')
      "
      :pagination="pagination"
    >
      <template #toolbar>
        <ListSearch
          v-model="search"
          :label="t('ui.customers.searchLabel')"
          :placeholder="t('ui.customers.searchPlaceholder')"
          @search="submitSearch"
        />
      </template>

      <div class="hidden overflow-x-auto md:block">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th :class="TH">{{ t('ui.customers.name') }}</th>
              <th :class="TH">{{ t('ui.customers.type') }}</th>
              <th :class="TH">{{ t('ui.customers.taxId') }}</th>
              <th :class="TH">{{ t('ui.customers.city') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="customer in customers" :key="customer.id" :class="OPENS_ROW">
              <td :class="TD">
                <Link
                  route="customers.show"
                  :params="{ id: customer.id }"
                  :class="cn(LINK, OPENS_LINK)"
                >
                  {{ customer.displayName }}
                </Link>
              </td>
              <td :class="TD">{{ customerTypeLabel(customer.type) }}</td>
              <td :class="cn(TD, 'font-mono')">{{ taxId(customer) }}</td>
              <td :class="TD">{{ place(customer) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="m-0 list-none p-0 md:hidden">
        <li v-for="customer in customers" :key="customer.id" :class="cn(ROW, OPENS_ROW)">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              route="customers.show"
              :params="{ id: customer.id }"
              :class="cn(LINK, OPENS_LINK, 'text-[15px] font-semibold')"
            >
              {{ customer.displayName }}
            </Link>
            <span class="text-[13px] text-muted-foreground">
              {{
                [customerTypeLabel(customer.type), taxId(customer), place(customer)]
                  .filter(Boolean)
                  .join(' · ')
              }}
            </span>
          </div>
        </li>
      </ul>
    </ListScreen>
  </AppLayout>
</template>
