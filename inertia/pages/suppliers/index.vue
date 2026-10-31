<script setup lang="ts">
/**
 * Fornitori, a List screen (docs/ui.md "Lists"). A Supplier has no page of
 * its own: its row opens its form.
 */
import { Link } from '@adonisjs/inertia/vue'
import type { ScreenAction } from '@shared/screen_actions'
import AppLayout from '~/layouts/app.vue'
import ListScreen from '~/components/screen/list_screen.vue'
import { LINK, OPENS_LINK, OPENS_ROW, ROW, TD, TH } from '~/components/screen/screen'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'

defineProps<{
  // New Supplier
  actions: ScreenAction[]
  suppliers: { id: number; name: string; vatId: string; city: string | null; invoices: number }[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()
</script>

<template>
  <AppLayout>
    <ListScreen
      :title="t('ui.suppliers.title')"
      :actions="actions"
      :description="t('ui.suppliers.description')"
      :empty="suppliers.length ? null : t('ui.suppliers.empty')"
      :pagination="pagination"
    >
      <div class="hidden overflow-x-auto md:block">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th :class="TH">{{ t('ui.suppliers.name') }}</th>
              <th :class="TH">{{ t('ui.suppliers.vatNumber') }}</th>
              <th :class="TH">{{ t('ui.suppliers.city') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.suppliers.invoices') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="supplier in suppliers" :key="supplier.id" :class="OPENS_ROW">
              <td :class="TD">
                <Link
                  route="suppliers.edit"
                  :params="{ id: supplier.id }"
                  :class="cn(LINK, OPENS_LINK)"
                >
                  {{ supplier.name }}
                </Link>
              </td>
              <td :class="cn(TD, 'font-mono')">{{ supplier.vatId }}</td>
              <td :class="TD">{{ supplier.city ?? '' }}</td>
              <td :class="cn(TD, 'text-right')">{{ supplier.invoices }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="m-0 list-none p-0 md:hidden">
        <li v-for="supplier in suppliers" :key="supplier.id" :class="cn(ROW, OPENS_ROW)">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              route="suppliers.edit"
              :params="{ id: supplier.id }"
              :class="cn(LINK, OPENS_LINK, 'text-[15px] font-semibold')"
            >
              {{ supplier.name }}
            </Link>
            <span class="text-[13px] text-muted-foreground">
              {{ [supplier.vatId, supplier.city].filter(Boolean).join(' · ') }}
            </span>
          </div>
          <span class="shrink-0 text-[13px] text-muted-foreground">
            {{ t('ui.suppliers.invoiceCount', { count: supplier.invoices }) }}
          </span>
        </li>
      </ul>
    </ListScreen>
  </AppLayout>
</template>
