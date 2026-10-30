<script setup lang="ts">
/**
 * The Customer, an Entity screen on the new UI (docs/ui.md): its header
 * actions come from the server; its Jobs and Invoices are the main work,
 * its details, Sites and documents beside them.
 */
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import SitePicker, { type PickedSite } from '~/components/site_picker.vue'
import { customerTypeLabel } from '~/components/customer_types'
import { urlFor } from '~/client'
import type { JobRow } from '~/components/screen/job_rows.vue'
import type { IssuedDocumentRow } from '~/components/issued_document_list.vue'
import { formatDate, formatMoney, t } from '~/i18n'
import { cn } from '~/lib/utils'
import type { PaymentStatus } from '@shared/payment_status'
import type { ScreenAction } from '@shared/screen_actions'
import { Button } from '~/components/ui/button'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import JobRows from '~/components/screen/job_rows.vue'
import IssuedDocumentRows from '~/components/screen/issued_document_rows.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import { LINK, PAYMENT_TONES, ROW, TD, TH } from '~/components/screen/screen'

const props = defineProps<{
  // The header's actions, for the user's role and the Customer's state
  actions: ScreenAction[]
  // The server decides whether Office may add a Legacy Invoice here
  canAddInvoice: boolean
  customer: {
    id: number
    displayName: string
    type: string
    vatNumber: string | null
    taxCode: string | null
    sdiCode: string
    pec: string | null
    billingAddress: string[]
    email: string | null
    phone: string | null
    notes: string | null
    paymentTerms: string
    archived: boolean
  }
  sites: { id: number; summary: string }[]
  jobs: { rows: JobRow[]; total: number }
  // Its Jobs still taking work
  openJobs: number
  issuedDocuments: IssuedDocumentRow[]
  balance: string
  overpaid: { id: number; number: string; overpaidBy: string }[]
  // Issued Invoices and Legacy Invoices, newest first
  invoices: {
    id: number
    number: string
    documentType: string
    advance: boolean
    issuedOn: string
    total: string
    payment: PaymentStatus
  }[]
}>()

const jobsHref = computed(() => `${urlFor('jobs.index')}?customerId=${props.customer.id}`)
// Every one of its Jobs, closed and cancelled included: what "Tutte le N commesse" counts
const allJobsHref = computed(() => `${jobsHref.value}&status=all`)

// The header: its line of identifying facts, and the key facts under it
const facts = computed(() =>
  [
    props.customer.vatNumber && `${t('ui.customers.vatNumber')} ${props.customer.vatNumber}`,
    props.customer.taxCode && `${t('ui.customers.taxCode')} ${props.customer.taxCode}`,
  ]
    .filter(Boolean)
    .join(' · ')
)
const keyFacts = computed<KeyFact[]>(() => [
  { label: t('ui.customers.type'), value: customerTypeLabel(props.customer.type) },
  {
    label: t('ui.customers.contact'),
    value: props.customer.phone ?? props.customer.email ?? '—',
    hint: props.customer.phone && props.customer.email ? props.customer.email : undefined,
  },
  { label: t('ui.jobs.openJobs'), value: String(props.openJobs), href: jobsHref.value },
  {
    label: t('ui.customers.balance'),
    value: formatMoney(props.balance),
    amount: true,
    hint: props.overpaid.length
      ? t('ui.customers.overpaidCount', { count: props.overpaid.length })
      : undefined,
  },
])

// The details, one under the other: the side column is narrow
const details = computed(() => {
  const { customer } = props
  return [
    [t('ui.customers.vatNumber'), customer.vatNumber],
    [t('ui.customers.taxCode'), customer.taxCode],
    [t('ui.customers.sdiCode'), customer.sdiCode],
    [t('ui.customers.pec'), customer.pec],
    [t('ui.customers.billingAddress'), customer.billingAddress.join('\n')],
    [t('ui.customers.email'), customer.email],
    [t('ui.customers.phone'), customer.phone],
    [t('ui.customers.paymentTerms'), customer.paymentTerms],
    [t('ui.customers.notes'), customer.notes],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label: label!, value: value! }))
})

// Why the picked Site wasn't linked (archived or gone since it was offered)
const linkError = ref<string | null>(null)

function linkSite(site: PickedSite) {
  linkError.value = null
  router.post(
    urlFor('customer_sites.store', { customerId: props.customer.id }),
    { siteId: site.id },
    { onError: (errors) => (linkError.value = errors.siteId ?? null) }
  )
}

const BUTTON = 'h-11 md:h-9'
// A section's action in the narrow side column: its label may wrap
const SIDE_BUTTON = 'h-auto min-h-11 max-w-full py-2 whitespace-normal md:min-h-9'
const EMPTY = 'm-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="customer.displayName"
      :crumbs="[{ label: t('ui.customers.title'), href: urlFor('customers.index') }]"
      :current="customer.displayName"
      :title="customer.displayName"
      :facts="facts"
      :actions="actions"
      :key-facts="keyFacts"
    >
      <template #tags>
        <StatusTag v-if="customer.archived" tone="grey">
          {{ t('ui.archive.archivedTag') }}
        </StatusTag>
      </template>

      <template #main>
        <ScreenSection :title="t('ui.jobs.title')" flush>
          <JobRows :jobs="jobs.rows" :total="jobs.total" :all-href="allJobsHref" show-site />
        </ScreenSection>

        <ScreenSection :title="t('ui.customers.invoicesTitle')" flush>
          <template v-if="canAddInvoice" #actions>
            <Button as-child variant="outline" :class="BUTTON">
              <Link route="legacy_invoices.create" :qs="{ customerId: customer.id }">
                {{ t('ui.invoices.newLegacy') }}
              </Link>
            </Button>
          </template>
          <p
            v-if="overpaid.length"
            class="m-0 flex items-start gap-1.5 border-t border-border px-3.5 py-3 text-sm md:px-4"
            data-testid="overpaid"
          >
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0 text-orange" />
            <span>
              {{ t('ui.customers.overpaid') }}:
              <template v-for="(invoice, index) in overpaid" :key="invoice.id">
                {{ index ? ', ' : '' }}
                <Link route="invoices.edit" :params="{ id: invoice.id }" :class="LINK">{{
                  t('ui.customers.overpaidInvoice', {
                    number: invoice.number,
                    amount: formatMoney(invoice.overpaidBy),
                  })
                }}</Link>
              </template>
            </span>
          </p>
          <template v-if="invoices.length">
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full border-collapse" data-testid="customer-invoices">
                <thead>
                  <tr>
                    <th :class="TH">{{ t('ui.invoices.number') }}</th>
                    <th :class="TH">{{ t('ui.issuedDocuments.issuedOn') }}</th>
                    <th :class="TH">{{ t('ui.invoices.payment') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.invoices.total') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="invoice in invoices" :key="invoice.id">
                    <td :class="TD">
                      <span class="flex flex-wrap items-center gap-1.5">
                        <Link
                          route="invoices.edit"
                          :params="{ id: invoice.id }"
                          :class="cn(LINK, 'font-semibold')"
                        >
                          {{ invoice.number }}
                        </Link>
                        <StatusTag v-if="invoice.documentType === 'legacy'" tone="grey">
                          {{ t('ui.invoices.legacy') }}
                        </StatusTag>
                        <StatusTag v-if="invoice.advance" tone="grey">
                          {{ t('ui.invoices.advance') }}
                        </StatusTag>
                      </span>
                    </td>
                    <td :class="cn(TD, 'whitespace-nowrap')">{{ formatDate(invoice.issuedOn) }}</td>
                    <td :class="TD">
                      <StatusTag :tone="PAYMENT_TONES[invoice.payment]">
                        {{ t(`ui.invoices.paymentStatuses.${invoice.payment}`) }}
                      </StatusTag>
                    </td>
                    <td :class="cn(TD, 'text-right font-semibold whitespace-nowrap')">
                      {{ formatMoney(invoice.total) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul class="m-0 list-none p-0 md:hidden">
              <li v-for="invoice in invoices" :key="invoice.id" :class="ROW">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    route="invoices.edit"
                    :params="{ id: invoice.id }"
                    :class="cn(LINK, 'text-[15px] font-semibold')"
                  >
                    {{ invoice.number }}
                  </Link>
                  <span class="text-[13px] text-muted-foreground">
                    {{ formatDate(invoice.issuedOn) }}
                  </span>
                  <span class="flex flex-wrap gap-1.5">
                    <StatusTag :tone="PAYMENT_TONES[invoice.payment]">
                      {{ t(`ui.invoices.paymentStatuses.${invoice.payment}`) }}
                    </StatusTag>
                    <StatusTag v-if="invoice.documentType === 'legacy'" tone="grey">
                      {{ t('ui.invoices.legacy') }}
                    </StatusTag>
                    <StatusTag v-if="invoice.advance" tone="grey">
                      {{ t('ui.invoices.advance') }}
                    </StatusTag>
                  </span>
                </div>
                <span class="text-[15px] font-bold whitespace-nowrap">
                  {{ formatMoney(invoice.total) }}
                </span>
              </li>
            </ul>
          </template>
          <p v-else :class="EMPTY">{{ t('ui.customers.noInvoices') }}</p>
        </ScreenSection>
      </template>

      <template #side>
        <ScreenSection :title="t('ui.customers.details')">
          <dl class="m-0 flex flex-col gap-2.5 text-sm">
            <div v-for="detail in details" :key="detail.label" class="flex flex-col gap-0.5">
              <dt class="text-[13px] text-muted-foreground">{{ detail.label }}</dt>
              <dd class="m-0 break-words whitespace-pre-line">{{ detail.value }}</dd>
            </div>
          </dl>
        </ScreenSection>

        <ScreenSection :title="t('ui.customers.sitesTitle')" flush>
          <template #actions>
            <Button as-child variant="outline" :class="SIDE_BUTTON">
              <Link route="sites.create" :qs="{ customerId: customer.id }">
                {{ t('ui.customers.newSite') }}
              </Link>
            </Button>
          </template>
          <p class="m-0 px-3.5 pb-2 text-[13px] text-muted-foreground md:px-4">
            {{ t('ui.customers.sitesDescription') }}
          </p>
          <ul v-if="sites.length" class="m-0 list-none p-0" data-testid="customer-sites">
            <li v-for="site in sites" :key="site.id" :class="cn(ROW, 'items-center')">
              <Link
                route="sites.show"
                :params="{ id: site.id }"
                :class="cn(LINK, 'min-w-0 flex-1 text-sm')"
              >
                {{ site.summary }}
              </Link>
              <Form
                route="customer_sites.destroy"
                :params="{ customerId: customer.id, siteId: site.id }"
              >
                <Button type="submit" variant="ghost" :class="BUTTON">
                  {{ t('ui.customers.unlink') }}
                </Button>
              </Form>
            </li>
          </ul>
          <p v-else :class="EMPTY">{{ t('ui.customers.noSites') }}</p>
          <div class="flex flex-col gap-1.5 border-t border-border px-3.5 py-3 md:px-4">
            <SitePicker
              :customer-id="customer.id"
              :label="t('ui.customers.linkSite')"
              :exclude-ids="sites.map((site) => site.id)"
              @select="linkSite"
            />
            <p v-if="linkError" class="m-0 flex items-start gap-1.5 text-sm text-destructive">
              <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
              {{ linkError }}
            </p>
          </div>
        </ScreenSection>

        <ScreenSection :title="t('ui.issuedDocuments.title')" flush>
          <template #actions>
            <Button as-child variant="outline" :class="SIDE_BUTTON">
              <Link route="issued_documents.create" :qs="{ customerId: customer.id }">
                {{ t('ui.issuedDocuments.newForCustomer') }}
              </Link>
            </Button>
          </template>
          <IssuedDocumentRows :documents="issuedDocuments" :show-customer="false" />
        </ScreenSection>
      </template>
    </EntityScreen>
  </AppLayout>
</template>
