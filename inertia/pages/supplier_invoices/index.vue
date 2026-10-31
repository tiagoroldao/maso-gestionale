<script setup lang="ts">
/**
 * Fatture passive, a List screen (docs/ui.md "Lists"), newest first. Above
 * the list, its two forms: uploading an invoice received outside the SDI,
 * and exporting a period's invoices for the accountant. The Suppliers are
 * a link away.
 */
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import type { ScreenAction } from '@shared/screen_actions'
import type { SupplierInvoiceStatus } from '@shared/supplier_invoices'
import { urlFor } from '~/client'
import AppLayout from '~/layouts/app.vue'
import ListScreen from '~/components/screen/list_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  LINK,
  OPENS_LINK,
  OPENS_ROW,
  ROW,
  SUPPLIER_INVOICE_TONES,
  TD,
  TH,
  TOUCH,
} from '~/components/screen/screen'
import { documentTypeLabel } from '~/components/supplier_invoices'
import { formatDate, formatMoney, t } from '~/i18n'
import { cn } from '~/lib/utils'

type Invoice = {
  id: number
  supplier: string
  documentType: string
  number: string
  issuedOn: string
  total: string
  status: SupplierInvoiceStatus
  receivedVia: string
}

defineProps<{
  // The Suppliers
  actions: ScreenAction[]
  invoices: Invoice[]
  pagination: { currentPage: number; lastPage: number; total: number }
  // The export's dates, back after a refused range; empty otherwise
  exportRange: { issuedFrom: string; issuedTo: string }
}>()

// The export form is a plain one, so its errors come with the page
const page = usePage()
const exportErrors = computed(() => page.props.errors ?? {})

const tone = (invoice: Invoice) => SUPPLIER_INVOICE_TONES[invoice.status]
// Anything but a plain invoice (TD01) says what it is
const kind = (invoice: Invoice) =>
  invoice.documentType === 'TD01' ? null : documentTypeLabel(invoice.documentType)
const FORM = 'flex flex-wrap items-end gap-3'
const FILE =
  'min-h-11 w-full max-w-sm text-sm text-foreground file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-card file:px-3 file:font-sans file:text-sm file:font-semibold file:text-foreground md:min-h-9'
</script>

<template>
  <AppLayout>
    <ListScreen
      :title="t('ui.supplierInvoices.title')"
      :actions="actions"
      :description="t('ui.supplierInvoices.description')"
      :empty="invoices.length ? null : t('ui.supplierInvoices.empty')"
      :pagination="pagination"
    >
      <template #toolbar>
        <div class="grid items-start gap-3 md:grid-cols-2 md:gap-5">
          <ScreenSection :title="t('ui.supplierInvoices.upload')">
            <Form
              v-slot="{ processing, errors }"
              route="supplier_invoices.store"
              reset-on-success
              :class="FORM"
            >
              <FormField
                id="supplier-invoice-file"
                v-slot="field"
                :label="t('ui.supplierInvoices.file')"
                :error="errors.invoice"
              >
                <input
                  :id="field.id"
                  name="invoice"
                  type="file"
                  accept=".xml,.p7m"
                  :aria-invalid="field.invalid === 'true'"
                  :aria-describedby="field.describedBy"
                  :class="FILE"
                />
              </FormField>
              <Button type="submit" :class="TOUCH" :disabled="processing">
                {{ t('ui.supplierInvoices.uploadSubmit') }}
              </Button>
            </Form>
          </ScreenSection>

          <ScreenSection
            :title="t('ui.supplierInvoices.export')"
            :description="t('ui.supplierInvoices.exportHint')"
          >
            <!-- A plain form: the answer is a file to download, not a page -->
            <form method="get" :action="urlFor('supplier_invoices.export')" :class="FORM">
              <FormField
                id="export-from"
                v-slot="field"
                :label="t('ui.supplierInvoices.exportFrom')"
                :error="exportErrors.issuedFrom"
              >
                <Input
                  :id="field.id"
                  name="issuedFrom"
                  :default-value="exportRange.issuedFrom"
                  type="date"
                  required
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                  :class="TOUCH"
                />
              </FormField>
              <FormField
                id="export-to"
                v-slot="field"
                :label="t('ui.supplierInvoices.exportTo')"
                :error="exportErrors.issuedTo"
              >
                <Input
                  :id="field.id"
                  name="issuedTo"
                  :default-value="exportRange.issuedTo"
                  type="date"
                  required
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                  :class="TOUCH"
                />
              </FormField>
              <Button type="submit" variant="outline" :class="TOUCH">
                {{ t('ui.supplierInvoices.exportSubmit') }}
              </Button>
            </form>
          </ScreenSection>
        </div>
      </template>

      <div class="hidden overflow-x-auto md:block">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th :class="TH">{{ t('ui.supplierInvoices.supplier') }}</th>
              <th :class="TH">{{ t('ui.supplierInvoices.number') }}</th>
              <th :class="TH">{{ t('ui.supplierInvoices.issuedOn') }}</th>
              <th :class="TH">{{ t('ui.supplierInvoices.status') }}</th>
              <th :class="cn(TH, 'text-right')">{{ t('ui.supplierInvoices.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="invoice in invoices" :key="invoice.id" :class="OPENS_ROW">
              <td :class="TD">
                <Link
                  route="supplier_invoices.show"
                  :params="{ id: invoice.id }"
                  :class="cn(LINK, OPENS_LINK)"
                >
                  {{ invoice.supplier }}
                </Link>
              </td>
              <td :class="cn(TD, 'whitespace-nowrap')">
                <span class="flex flex-wrap items-center gap-1.5">
                  <span class="font-mono">{{ invoice.number }}</span>
                  <StatusTag v-if="kind(invoice)" tone="grey">{{ kind(invoice) }}</StatusTag>
                </span>
              </td>
              <td :class="cn(TD, 'whitespace-nowrap')">{{ formatDate(invoice.issuedOn) }}</td>
              <td :class="TD">
                <StatusTag :tone="tone(invoice)">
                  {{ t(`ui.supplierInvoices.statuses.${invoice.status}`) }}
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
              route="supplier_invoices.show"
              :params="{ id: invoice.id }"
              :class="cn(LINK, OPENS_LINK, 'text-[15px] font-semibold')"
            >
              {{ invoice.supplier }}
            </Link>
            <span class="text-[13px] text-muted-foreground">
              {{ invoice.number }} · {{ formatDate(invoice.issuedOn) }}
            </span>
            <span class="flex flex-wrap gap-1.5">
              <StatusTag :tone="tone(invoice)">
                {{ t(`ui.supplierInvoices.statuses.${invoice.status}`) }}
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
