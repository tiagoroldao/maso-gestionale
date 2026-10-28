<script setup lang="ts">
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { urlFor } from '~/client'
import { INVOICE_STAGES } from '@shared/invoice_lifecycle'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate } from '@shared/dates'
import { formatMoney, t } from '~/i18n'

const props = defineProps<{
  stage: string
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

const stage = ref(props.stage)

function filter() {
  router.get(urlFor('invoices.index'), stage.value === 'all' ? {} : { stage: stage.value }, {
    preserveState: true,
    replace: true,
  })
}
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.invoices.title')">
      <template #actions>
        <Link route="invoices.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> {{ t('ui.invoices.new') }}
        </Link>
      </template>

      <div class="field" :style="{ maxWidth: '280px' }">
        <label class="field__label" for="stage">{{ t('ui.invoices.stage') }}</label>
        <select id="stage" v-model="stage" class="field__input" @change="filter">
          <option v-for="code in INVOICE_STAGES" :key="code" :value="code">
            {{ t(`ui.invoices.stages.${code}`) }}
          </option>
        </select>
      </div>

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
