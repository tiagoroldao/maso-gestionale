<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate } from '@shared/dates'
import { formatMoney, t } from '~/i18n'

defineProps<{
  invoices: {
    id: number
    number: string | null
    issuedOn: string | null
    status: string
    customer: string
    createdAt: string
    total: string
  }[]
}>()
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.invoices.title')">
      <template #actions>
        <Link route="invoices.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> {{ t('ui.invoices.new') }}
        </Link>
      </template>

      <table v-if="invoices.length" class="table">
        <thead>
          <tr>
            <th>{{ t('ui.invoices.number') }}</th>
            <th>{{ t('ui.invoices.customer') }}</th>
            <th>{{ t('ui.invoices.status') }}</th>
            <th>{{ t('ui.invoices.createdOn') }}</th>
            <th :style="{ textAlign: 'right' }">{{ t('ui.invoices.total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="invoice in invoices" :key="invoice.id">
            <td class="mono">{{ invoice.number ?? '' }}</td>
            <td>
              <Link route="invoices.edit" :params="{ id: invoice.id }" class="il">
                {{ invoice.customer }}
              </Link>
            </td>
            <td>
              <span class="tag">{{ t(`ui.invoices.statuses.${invoice.status}`) }}</span>
            </td>
            <td>{{ formatDate(invoice.issuedOn ?? invoice.createdAt) }}</td>
            <td :style="{ textAlign: 'right' }">{{ formatMoney(invoice.total) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.invoices.empty') }}</p>
    </Page>
  </AppLayout>
</template>
