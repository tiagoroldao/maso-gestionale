<script setup lang="ts">
/**
 * Fatture, a List screen (docs/ui.md "Lists"), newest first, filtered by
 * stage. A new Invoice is the primary; a Legacy one, secondary.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import type { ScreenAction } from '@shared/screen_actions'
import { INVOICE_STAGES, type InvoiceStatus } from '@shared/invoice_lifecycle'
import type { PaymentStatus } from '@shared/payment_status'
import { formatDate } from '@shared/dates'
import AppLayout from '~/layouts/app.vue'
import ListScreen from '~/components/screen/list_screen.vue'
import FormField from '~/components/screen/form_field.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import { NativeSelect } from '~/components/ui/native-select'
import {
  INVOICE_TONES,
  LINK,
  OPENS_LINK,
  OPENS_ROW,
  PAYMENT_TONES,
  ROW,
  TD,
  TH,
} from '~/components/screen/screen'
import { urlFor } from '~/client'
import { formatMoney, t } from '~/i18n'
import { cn } from '~/lib/utils'

type Invoice = {
  id: number
  number: string | null
  issuedOn: string | null
  status: InvoiceStatus
  documentType: string
  customer: string
  createdAt: string
  total: string
  payment: PaymentStatus | null
}

const props = defineProps<{
  // New Invoice; a new Legacy Invoice
  actions: ScreenAction[]
  stage: string
  invoices: Invoice[]
}>()

const stage = ref(props.stage)

function filter() {
  router.get(urlFor('invoices.index'), stage.value === 'all' ? {} : { stage: stage.value }, {
    preserveState: true,
    replace: true,
  })
}

const statusTone = (invoice: Invoice) => INVOICE_TONES[invoice.status]
// A Credit Note or a Legacy Invoice says so beside its number
const kind = (invoice: Invoice) =>
  invoice.documentType === 'credit_note'
    ? t('ui.invoices.creditNote')
    : invoice.documentType === 'legacy'
      ? t('ui.invoices.legacy')
      : null
const date = (invoice: Invoice) => formatDate(invoice.issuedOn ?? invoice.createdAt)
</script>

<template>
  <AppLayout>
    <ListScreen
      :title="t('ui.invoices.title')"
      :actions="actions"
      :empty="invoices.length ? null : t('ui.invoices.empty')"
    >
      <template #toolbar>
        <FormField id="stage" v-slot="field" :label="t('ui.invoices.stage')" class="md:w-72">
          <NativeSelect :id="field.id" v-model="stage" @change="filter">
            <option v-for="code in INVOICE_STAGES" :key="code" :value="code">
              {{ t(`ui.invoices.stages.${code}`) }}
            </option>
          </NativeSelect>
        </FormField>
      </template>

      <div class="hidden overflow-x-auto md:block">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th :class="TH">{{ t('ui.invoices.number') }}</th>
              <th :class="TH">{{ t('ui.invoices.customer') }}</th>
              <th :class="TH">{{ t('ui.invoices.status') }}</th>
              <th :class="TH">{{ t('ui.invoices.createdOn') }}</th>
              <th :class="TH">{{ t('ui.invoices.payment') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.invoices.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="invoice in invoices" :key="invoice.id" :class="OPENS_ROW">
              <td :class="cn(TD, 'whitespace-nowrap')">
                <span class="flex flex-wrap items-center gap-1.5">
                  <span class="font-mono">{{ invoice.number ?? '' }}</span>
                  <StatusTag v-if="kind(invoice)" tone="grey">{{ kind(invoice) }}</StatusTag>
                </span>
              </td>
              <td :class="TD">
                <Link
                  route="invoices.edit"
                  :params="{ id: invoice.id }"
                  :class="cn(LINK, OPENS_LINK)"
                >
                  {{ invoice.customer }}
                </Link>
              </td>
              <td :class="TD">
                <StatusTag :tone="statusTone(invoice)">
                  {{ t(`ui.invoices.statuses.${invoice.status}`) }}
                </StatusTag>
              </td>
              <td :class="cn(TD, 'whitespace-nowrap')">{{ date(invoice) }}</td>
              <td :class="TD">
                <StatusTag v-if="invoice.payment" :tone="PAYMENT_TONES[invoice.payment]">
                  {{ t(`ui.invoices.paymentStatuses.${invoice.payment}`) }}
                </StatusTag>
              </td>
              <td :class="cn(TD, 'text-right whitespace-nowrap')">
                {{ formatMoney(invoice.total) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="m-0 list-none p-0 md:hidden">
        <li v-for="invoice in invoices" :key="invoice.id" :class="cn(ROW, OPENS_ROW)">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <Link
              route="invoices.edit"
              :params="{ id: invoice.id }"
              :class="cn(LINK, OPENS_LINK, 'text-[15px] font-semibold')"
            >
              {{ invoice.customer }}
            </Link>
            <span class="text-[13px] text-muted-foreground">
              {{ [invoice.number, date(invoice)].filter(Boolean).join(' · ') }}
            </span>
            <span class="flex flex-wrap gap-1.5">
              <StatusTag :tone="statusTone(invoice)">
                {{ t(`ui.invoices.statuses.${invoice.status}`) }}
              </StatusTag>
              <StatusTag v-if="invoice.payment" :tone="PAYMENT_TONES[invoice.payment]">
                {{ t(`ui.invoices.paymentStatuses.${invoice.payment}`) }}
              </StatusTag>
              <StatusTag v-if="kind(invoice)" tone="grey">{{ kind(invoice) }}</StatusTag>
            </span>
          </div>
          <span class="shrink-0 text-[15px] font-semibold whitespace-nowrap">
            {{ formatMoney(invoice.total) }}
          </span>
        </li>
      </ul>
    </ListScreen>
  </AppLayout>
</template>
