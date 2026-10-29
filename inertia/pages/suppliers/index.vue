<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Pagination from '~/components/pagination.vue'
import AppLayout from '~/layouts/app.vue'
import { t } from '~/i18n'

defineProps<{
  suppliers: { id: number; name: string; vatId: string; city: string | null; invoices: number }[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.suppliers.title')" :description="t('ui.suppliers.description')">
      <template #actions>
        <Link route="suppliers.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> {{ t('ui.suppliers.new') }}
        </Link>
      </template>

      <table v-if="suppliers.length" class="table">
        <thead>
          <tr>
            <th>{{ t('ui.suppliers.name') }}</th>
            <th>{{ t('ui.suppliers.vatNumber') }}</th>
            <th>{{ t('ui.suppliers.city') }}</th>
            <th :style="{ textAlign: 'right' }">{{ t('ui.suppliers.invoices') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="supplier in suppliers" :key="supplier.id">
            <td>
              <Link route="suppliers.edit" :params="{ id: supplier.id }" class="il">
                {{ supplier.name }}
              </Link>
            </td>
            <td class="mono">{{ supplier.vatId }}</td>
            <td>{{ supplier.city ?? '' }}</td>
            <td :style="{ textAlign: 'right' }">{{ supplier.invoices }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.suppliers.empty') }}</p>
      <Pagination v-bind="pagination" />
    </Page>
  </AppLayout>
</template>
