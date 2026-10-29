<script setup lang="ts">
import { computed } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, t } from '~/i18n'
import { vatLabel } from '@shared/vat'
import type { SupplierInvoiceDetails } from '@shared/supplier_invoices'
import { documentTypeLabel, formatAmount, paymentMethodLabel } from '~/components/supplier_invoices'

const props = defineProps<{
  invoice: {
    id: number
    documentType: string
    currency: string
    number: string
    issuedOn: string
    taxable: string
    vat: string
    total: string
    status: string
    receivedVia: string
    receivedOn: string
    sdiIdentifier: string | null
    fileName: string
    supplier: { id: number; name: string }
    details: SupplierInvoiceDetails
    lines: {
      id: number
      lineNumber: number
      code: string | null
      description: string
      quantity: string | null
      unit: string | null
      unitPrice: string
      total: string
      vatRate: string
      natura: string | null
    }[]
  }
}>()

const money = (amount: string, decimals = 2) =>
  formatAmount(amount, props.invoice.currency, decimals)
const seller = computed(() => props.invoice.details.seller)
const sellerAddress = computed(() => {
  const address = seller.value.address
  if (!address) return null
  const street = [address.street, address.streetNumber].filter(Boolean).join(', ')
  const place = [address.postalCode, address.city, address.province && `(${address.province})`]
    .filter(Boolean)
    .join(' ')
  return [street, place, address.country !== 'IT' ? address.country : null]
    .filter(Boolean)
    .join(' · ')
})
const quantity = (value: string | null) =>
  value === null ? '' : Number(value).toLocaleString('it', { maximumFractionDigits: 8 })
</script>

<template>
  <AppLayout>
    <Page
      :title="
        t('ui.supplierInvoices.showTitle', {
          number: invoice.number,
          supplier: invoice.supplier.name,
        })
      "
      :description="
        t('ui.supplierInvoices.received', {
          source: t(`ui.supplierInvoices.sources.${invoice.receivedVia}`),
          date: formatDate(invoice.receivedOn),
        })
      "
    >
      <template #actions>
        <span class="tag">{{ t(`ui.supplierInvoices.statuses.${invoice.status}`) }}</span>
        <Form
          v-if="invoice.status === 'to_handle'"
          route="supplier_invoices.mark_handled"
          :params="{ id: invoice.id }"
        >
          <button type="submit" class="btn btn--primary btn--sm">
            {{ t('ui.supplierInvoices.markHandled') }}
          </button>
        </Form>
        <Form v-else route="supplier_invoices.mark_to_handle" :params="{ id: invoice.id }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.supplierInvoices.markToHandle') }}
          </button>
        </Form>
        <a
          :href="urlFor('supplier_invoices.file', { id: invoice.id })"
          class="btn btn--secondary btn--sm"
        >
          {{ t('ui.supplierInvoices.download', { name: invoice.fileName }) }}
        </a>
      </template>

      <Section :title="t('ui.supplierInvoices.document')">
        <dl class="details">
          <dt>{{ t('ui.supplierInvoices.documentType') }}</dt>
          <dd>{{ documentTypeLabel(invoice.documentType) }} ({{ invoice.documentType }})</dd>
          <dt>{{ t('ui.supplierInvoices.number') }}</dt>
          <dd class="mono">{{ invoice.number }}</dd>
          <dt>{{ t('ui.supplierInvoices.issuedOn') }}</dt>
          <dd>{{ formatDate(invoice.issuedOn) }}</dd>
          <template v-if="invoice.currency !== 'EUR'">
            <dt>{{ t('ui.supplierInvoices.currency') }}</dt>
            <dd>{{ invoice.currency }}</dd>
          </template>
          <template v-if="invoice.sdiIdentifier">
            <dt>{{ t('ui.supplierInvoices.sdiIdentifier') }}</dt>
            <dd class="mono">{{ invoice.sdiIdentifier }}</dd>
          </template>
          <template v-if="invoice.details.notes.length">
            <dt>{{ t('ui.supplierInvoices.notes') }}</dt>
            <dd>
              <p v-for="(note, index) in invoice.details.notes" :key="index">{{ note }}</p>
            </dd>
          </template>
        </dl>
      </Section>

      <Section :title="t('ui.supplierInvoices.seller')">
        <dl class="details">
          <dt>{{ t('ui.supplierInvoices.supplier') }}</dt>
          <dd>
            <Link route="suppliers.edit" :params="{ id: invoice.supplier.id }" class="il">
              {{ seller.name }}
            </Link>
          </dd>
          <dt>{{ t('ui.supplierInvoices.vatId') }}</dt>
          <dd class="mono">{{ seller.vatCountry }}{{ seller.vatNumber }}</dd>
          <template v-if="seller.taxCode">
            <dt>{{ t('ui.supplierInvoices.taxCode') }}</dt>
            <dd class="mono">{{ seller.taxCode }}</dd>
          </template>
          <template v-if="sellerAddress">
            <dt>{{ t('ui.suppliers.street') }}</dt>
            <dd>{{ sellerAddress }}</dd>
          </template>
        </dl>
      </Section>

      <Section :title="t('ui.supplierInvoices.buyer')">
        <dl class="details">
          <dt>{{ t('ui.suppliers.name') }}</dt>
          <dd>{{ invoice.details.buyer.name }}</dd>
          <template v-if="invoice.details.buyer.vatNumber">
            <dt>{{ t('ui.supplierInvoices.vatId') }}</dt>
            <dd class="mono">{{ invoice.details.buyer.vatNumber }}</dd>
          </template>
          <template v-if="invoice.details.buyer.taxCode">
            <dt>{{ t('ui.supplierInvoices.taxCode') }}</dt>
            <dd class="mono">{{ invoice.details.buyer.taxCode }}</dd>
          </template>
        </dl>
      </Section>

      <Section :title="t('ui.supplierInvoices.lines')">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.supplierInvoices.lineNumber') }}</th>
              <th>{{ t('ui.supplierInvoices.code') }}</th>
              <th>{{ t('ui.supplierInvoices.description') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.quantity') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.unitPrice') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.lineTotal') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.vatRate') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in invoice.lines" :key="line.id">
              <td>{{ line.lineNumber }}</td>
              <td class="mono">{{ line.code ?? '' }}</td>
              <td :style="{ whiteSpace: 'pre-line' }">{{ line.description }}</td>
              <td :style="{ textAlign: 'right' }">
                {{ quantity(line.quantity) }} {{ line.unit ?? '' }}
              </td>
              <td :style="{ textAlign: 'right' }">{{ money(line.unitPrice, 8) }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(line.total, 8) }}</td>
              <td :style="{ textAlign: 'right' }">{{ vatLabel(line) }}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section :title="t('ui.supplierInvoices.summary')">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.supplierInvoices.vatRate') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.taxable') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.vat') }}</th>
              <th>{{ t('ui.supplierInvoices.reference') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in invoice.details.summary" :key="index">
              <td>{{ vatLabel(row) }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(row.taxable) }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(row.vat) }}</td>
              <td>{{ row.reference ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <dl class="details">
          <dt>{{ t('ui.supplierInvoices.taxable') }}</dt>
          <dd>{{ money(invoice.taxable) }}</dd>
          <dt>{{ t('ui.supplierInvoices.vat') }}</dt>
          <dd>{{ money(invoice.vat) }}</dd>
          <dt>{{ t('ui.supplierInvoices.total') }}</dt>
          <dd>
            <strong>{{ money(invoice.total) }}</strong>
          </dd>
        </dl>
      </Section>

      <Section v-if="invoice.details.payments.length" :title="t('ui.supplierInvoices.payments')">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.supplierInvoices.paymentMethod') }}</th>
              <th>{{ t('ui.supplierInvoices.dueOn') }}</th>
              <th>{{ t('ui.supplierInvoices.iban') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(payment, index) in invoice.details.payments" :key="index">
              <td>{{ paymentMethodLabel(payment.method) }}</td>
              <td>{{ payment.dueOn ? formatDate(payment.dueOn) : '' }}</td>
              <td class="mono">{{ payment.iban ?? '' }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(payment.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </Page>
  </AppLayout>
</template>
