<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import Pagination from '~/components/pagination.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, formatMoney, t } from '~/i18n'
import { documentTypeLabel } from '~/components/supplier_invoices'

defineProps<{
  invoices: {
    id: number
    supplier: string
    documentType: string
    number: string
    issuedOn: string
    total: string
    status: string
    receivedVia: string
  }[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()
</script>

<template>
  <AppLayout>
    <Page
      :title="t('ui.supplierInvoices.title')"
      :description="t('ui.supplierInvoices.description')"
    >
      <template #actions>
        <Link route="suppliers.index" class="btn btn--secondary btn--sm">
          {{ t('ui.supplierInvoices.suppliers') }}
        </Link>
      </template>

      <Section :title="t('ui.supplierInvoices.upload')">
        <Form
          v-slot="{ processing, errors }"
          route="supplier_invoices.store"
          reset-on-success
          :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }"
        >
          <div class="field">
            <label class="field__label" for="supplier-invoice-file">
              {{ t('ui.supplierInvoices.file') }}
            </label>
            <input id="supplier-invoice-file" name="invoice" type="file" accept=".xml,.p7m" />
            <span v-if="errors.invoice" class="field__error">{{ errors.invoice }}</span>
          </div>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.supplierInvoices.uploadSubmit') }}
          </button>
        </Form>
      </Section>

      <table v-if="invoices.length" class="table">
        <thead>
          <tr>
            <th>{{ t('ui.supplierInvoices.supplier') }}</th>
            <th>{{ t('ui.supplierInvoices.number') }}</th>
            <th>{{ t('ui.supplierInvoices.issuedOn') }}</th>
            <th>{{ t('ui.supplierInvoices.status') }}</th>
            <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="invoice in invoices" :key="invoice.id">
            <td>
              <Link route="supplier_invoices.show" :params="{ id: invoice.id }" class="il">
                {{ invoice.supplier }}
              </Link>
            </td>
            <td class="mono">
              {{ invoice.number }}
              <span v-if="invoice.documentType !== 'TD01'" class="tag">
                {{ documentTypeLabel(invoice.documentType) }}
              </span>
            </td>
            <td>{{ formatDate(invoice.issuedOn) }}</td>
            <td>
              <span class="tag">{{ t(`ui.supplierInvoices.statuses.${invoice.status}`) }}</span>
            </td>
            <td :style="{ textAlign: 'right' }">{{ formatMoney(invoice.total) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.supplierInvoices.empty') }}</p>
      <Pagination v-bind="pagination" />
    </Page>
  </AppLayout>
</template>
