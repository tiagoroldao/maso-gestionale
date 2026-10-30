<script setup lang="ts">
/**
 * The Job, an Entity screen on the new UI (docs/ui.md, mockups
 * "commessa-desktop" and "commessa-phone"): its header actions come from
 * the server; the Visits are the main work, the documents beside them,
 * the Charges and their summary full width below.
 */
import type { QuoteStatus } from '@shared/quotes'
import { Form, Link } from '@adonisjs/inertia/vue'
import { ChevronDown } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import { formatDate, formatMoney, t } from '~/i18n'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import { amountForInput } from '@shared/money'
import type { ChargeState, WorkState } from '@shared/charges'
import type { AdvanceState } from '@shared/advances'
import type { InvoiceStatus } from '@shared/invoice_lifecycle'
import { LINE_KINDS } from '@shared/vat'
import type { JobIndicators, JobStatus } from '@shared/jobs'
import type { ScreenAction } from '@shared/screen_actions'
import { DEFAULT_ORGANISE_BY, ORGANISE_BY } from '@shared/invoice_sections'
import { computed, ref } from 'vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { DialogDescription } from '~/components/ui/dialog'
import type { IssuedDocumentRow } from '~/components/issued_document_list.vue'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import ItemPreview from '~/components/item_preview.vue'
import FormField from '~/components/screen/form_field.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import {
  CHARGE_TONES,
  INVOICE_TONES,
  JOB_INDICATOR_TONES,
  JOB_TONES,
  LINK,
  PREVIEW_LINK,
  QUOTE_TONES,
  ROW,
  TD,
  TH,
  VISIT_TONES,
  WORK_TONES,
} from '~/components/screen/screen'

type WorkTotals = { planned: string; done: string; notDone: string }
type SummaryRow = WorkTotals & { visits: (WorkTotals & { visitId: number | null })[] }

const props = defineProps<{
  // The header's actions, for the user's role and the Job's status
  actions: ScreenAction[]
  quotes: { id: number; number: string; status: QuoteStatus; total: string }[]
  canWriteQuote: boolean
  // The server decides whether Office may add a cost here (docs/ui.md "Actions")
  canAddCharge: boolean
  invoices: {
    id: number
    number: string | null
    status: InvoiceStatus
    total: string
    advance: boolean
    legacy: boolean
    deduction: { deducted: string; credited: string; state: AdvanceState } | null
    // Its Credit Notes, drafts included (ADR 0014)
    creditNotes: { id: number; number: string | null; status: InvoiceStatus; total: string }[]
  }[]
  canInvoice: boolean
  canInvoiceAdvance: boolean
  // What closing would leave behind (ADR 0015); null unless open or in progress
  leftToClose: {
    visits: number
    charges: number
    unpaid: number
    overpaid: number
    advances: number
    drafts: number
  } | null
  invoicedSoFar: { amount: string; of: string; quoted: string | null }
  timeAndMaterials: {
    total: string
    toBill: string
    billed: string
    inDraft: string
    lines: number
  }
  callOutFee: string | null
  // Where the Visits stand, cancelled ones apart (#178)
  progress: {
    done: number
    total: number
    cancelled: number
    next: { startsAt: string; endsAt: string } | null
  }
  // Templates to issue the Job's work report from, and the Job's Issued
  // Documents (#180)
  workReportTemplates: { id: number; name: string }[]
  issuedDocuments: IssuedDocumentRow[]
  // Hours and Items across the Visits and the Job, by work state (#178)
  summary: {
    hours: (SummaryRow & {
      key: string
      worker: string | null
      labourRate: string | null
      unit: string
    })[]
    items: (SummaryRow & { itemId: number; item: string; unit: string | null })[]
  }
  charges: {
    id: number
    visitId: number | null
    description: string
    // An Item's Charge opens the Item's preview; null for others, or when the user can't open Items
    itemId: number | null
    unit: string | null
    quantity: string
    unitPrice: string
    amount: string
    state: ChargeState
    workState: WorkState
  }[]
  job: {
    id: number
    number: string
    title: string
    workCategory: string
    status: JobStatus
    indicators: JobIndicators | null
    description: string | null
    customer: { id: number; displayName: string } | null
    site: { id: number; summary: string } | null
    createdAt: string
    cancelledAt: string | null
    closedAt: string | null
  }
  visits: {
    id: number
    startsAt: string
    endsAt: string
    status: string
    survey: boolean
    closableByOffice: boolean
    billed: boolean
    charges: { id: number; description: string }[]
    technicians: string[]
    notes: { id: number; body: string; author: string | null }[]
    photoIds: number[]
  }[]
}>()

const left = computed(() =>
  Object.entries(props.leftToClose ?? {}).filter(([, count]) => count > 0)
)
const indicators = computed(() =>
  (Object.keys(props.job.indicators ?? {}) as (keyof JobIndicators)[]).filter(
    (key) => props.job.indicators?.[key]
  )
)

// The header: its line of identifying facts, and the key facts under it
const facts = computed(() =>
  [
    props.job.number,
    t(`ui.jobs.workCategories.${props.job.workCategory}`),
    t('ui.jobs.openedOn', { date: formatDate(props.job.createdAt) }),
    props.job.closedAt && t('ui.jobs.closedOn', { date: formatDate(props.job.closedAt) }),
    props.job.cancelledAt && t('ui.jobs.cancelledOn', { date: formatDate(props.job.cancelledAt) }),
  ]
    .filter(Boolean)
    .join(' · ')
)
const keyFacts = computed<KeyFact[]>(() => [
  {
    label: t('ui.jobs.customer'),
    value: props.job.customer?.displayName ?? '—',
    href: props.job.customer ? urlFor('customers.show', { id: props.job.customer.id }) : undefined,
  },
  {
    label: t('ui.jobs.site'),
    value: props.job.site?.summary ?? t('ui.jobs.noSite'),
    href: props.job.site ? urlFor('sites.show', { id: props.job.site.id }) : undefined,
  },
  {
    label: t('ui.jobs.toBill'),
    value: formatMoney(props.timeAndMaterials.toBill),
    amount: true,
    hint: Number(props.timeAndMaterials.inDraft)
      ? t('ui.jobs.toBillInDraft', { amount: formatMoney(props.timeAndMaterials.inDraft) })
      : undefined,
  },
  {
    label: t('ui.jobs.invoiced'),
    value: formatMoney(props.invoicedSoFar.amount),
    amount: true,
    hint: [
      t('ui.jobs.invoicedOf', { amount: formatMoney(props.invoicedSoFar.of) }),
      props.invoicedSoFar.quoted &&
        t('ui.invoices.quotedTotal', { amount: formatMoney(props.invoicedSoFar.quoted) }),
    ]
      .filter(Boolean)
      .join(' · '),
  },
])

const quantity = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')
const visitDay = (visit: { startsAt: string }) => formatDate(visit.startsAt)
const visitHours = (visit: { startsAt: string; endsAt: string }) =>
  `${visit.startsAt.slice(11, 16)}–${visit.endsAt.slice(11, 16)}`
const visitTime = (visit: { startsAt: string; endsAt: string }) =>
  `${visitDay(visit)} ${visitHours(visit)}`
// Where a Charge or a summary figure comes from: a Visit, or the Job itself
function chargeSource(visitId: number | null, withTime = false) {
  if (visitId === null) return t('ui.charges.onJob')
  const visit = props.visits.find((candidate) => candidate.id === visitId)
  if (!visit) return ''
  return withTime ? visitTime(visit) : t('ui.charges.visit', { date: visitDay(visit) })
}
// The summary's figures: each one and the work state it totals
const WORK_COLUMNS = [
  ['planned', 'planned'],
  ['done', 'done'],
  ['notDone', 'not_done'],
] as const
function figures(row: WorkTotals, unit: string | null, all = true) {
  return WORK_COLUMNS.filter(([key]) => all || Number(row[key]))
    .map(
      ([key, state]) =>
        `${t(`ui.charges.workStates.${state}`)} ${quantity(row[key])}${unit ? ` ${unit}` : ''}`
    )
    .join(' · ')
}
const closable = computed(() => props.visits.filter((visit) => visit.closableByOffice))

// The header's dialogs, by action name: the draft's options, and closing
const draftOpen = ref(false)
const closeOpen = ref(false)
function openDialog(name: string) {
  if (name === 'draftInvoice') draftOpen.value = true
  if (name === 'close') closeOpen.value = true
}
// A draft from the Charges combines alike ones unless unticked (ADR 0017)
const combine = ref(true)
const organiseBy = ref<string>(DEFAULT_ORGANISE_BY)

// The new cost's fields, pre-filled with the call-out fee on request
const chargeOpen = ref(false)
const blankCharge = () => ({
  description: '',
  quantity: '1',
  unit: '',
  unitPrice: '',
  vatKind: 'labour',
})
const newCharge = ref(blankCharge())
function fillCallOut(fee: string) {
  newCharge.value = {
    ...blankCharge(),
    description: t('ui.charges.callOut'),
    unitPrice: amountForInput(fee),
  }
}
function chargeAdded() {
  newCharge.value = blankCharge()
  chargeOpen.value = false
}

// Marking a Visit done is final, so it asks first
const markDoneOpen = ref(false)
let markDone: (() => void) | null = null
function askMarkDone(submit: () => void) {
  markDone = submit
  markDoneOpen.value = true
}

// The Item a Charge names, previewed over the Job (docs/ui.md "Hierarchy and references")
const previewedItem = ref<number | null>(null)

const BUTTON = 'h-11 md:h-9'
const SUB = 'm-0 text-xs font-semibold text-muted-foreground'
const PHOTO = 'block size-14 rounded-sm border border-border object-cover'
const SUMMARY_TOGGLE =
  'flex min-h-11 cursor-pointer list-none items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="`${job.number} · ${job.title}`"
      :crumbs="[{ label: t('ui.jobs.title'), href: urlFor('jobs.index') }]"
      :current="job.number"
      :title="job.title"
      :facts="facts"
      :actions="actions"
      :key-facts="keyFacts"
      @dialog="openDialog"
    >
      <template #tags>
        <StatusTag :tone="JOB_TONES[job.status]">{{
          t(`ui.jobs.statuses.${job.status}`)
        }}</StatusTag>
        <StatusTag
          v-for="key in indicators"
          :key="key"
          :tone="JOB_INDICATOR_TONES[key]"
          data-testid="job-indicator"
        >
          {{ t(`ui.jobs.indicators.${key}`) }}
        </StatusTag>
      </template>

      <template #main>
        <ScreenSection :title="t('ui.visits.title')" flush>
          <!-- Collapsed by default, a long Job having many Visits (#178), unless
               one waits for Office to mark it done (#153) -->
          <details
            v-if="visits.length"
            :open="closable.length > 0"
            class="group"
            data-testid="visits"
          >
            <summary
              :class="cn(SUMMARY_TOGGLE, 'border-t border-border px-3.5 text-sm md:px-4')"
              data-testid="visit-progress"
            >
              <ChevronDown
                :size="16"
                aria-hidden="true"
                class="shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0"
              />
              <span>
                {{ t('ui.jobs.progress', { done: progress.done, total: progress.total }) }}
                <template v-if="progress.cancelled">
                  · {{ t('ui.jobs.progressCancelled', { count: progress.cancelled }) }}
                </template>
                <template v-if="progress.next">
                  · {{ t('ui.jobs.progressNext', { when: visitTime(progress.next) }) }}
                </template>
              </span>
            </summary>

            <div class="hidden overflow-x-auto md:block">
              <table class="w-full border-collapse">
                <thead>
                  <tr>
                    <th :class="TH">{{ t('ui.visits.date') }}</th>
                    <th :class="TH">{{ t('ui.visits.time') }}</th>
                    <th :class="TH">{{ t('ui.visits.technicians') }}</th>
                    <th :class="TH">{{ t('ui.jobs.status') }}</th>
                    <th :class="TH">
                      <span class="sr-only">{{ t('ui.common.edit') }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="visit in visits" :key="visit.id">
                    <td :class="cn(TD, 'font-semibold whitespace-nowrap')">
                      <Link
                        route="visits.schedule"
                        :qs="{ date: visit.startsAt.slice(0, 10) }"
                        :class="LINK"
                      >
                        {{ visitDay(visit) }}
                      </Link>
                    </td>
                    <td :class="cn(TD, 'whitespace-nowrap')">{{ visitHours(visit) }}</td>
                    <td :class="TD">
                      {{ visit.technicians.join(', ') }}
                      <p
                        v-for="note in visit.notes"
                        :key="note.id"
                        class="m-0 text-[13px] text-muted-foreground"
                      >
                        {{ note.author }}: {{ note.body }}
                      </p>
                      <div v-if="visit.photoIds.length" class="mt-1.5 flex flex-wrap gap-1.5">
                        <a
                          v-for="photoId in visit.photoIds"
                          :key="photoId"
                          :href="urlFor('visit_photos.show', { id: photoId })"
                          target="_blank"
                          rel="noopener"
                          class="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <img
                            :src="urlFor('visit_photos.show', { id: photoId })"
                            :alt="t('ui.field.photo')"
                            loading="lazy"
                            :class="PHOTO"
                          />
                        </a>
                      </div>
                    </td>
                    <td :class="TD">
                      <span class="flex flex-wrap gap-1.5">
                        <StatusTag v-if="visit.survey" tone="grey">
                          {{ t('ui.visits.survey') }}
                        </StatusTag>
                        <StatusTag :tone="VISIT_TONES[visit.status] ?? 'grey'">
                          {{ t(`ui.visits.statuses.${visit.status}`) }}
                        </StatusTag>
                        <StatusTag v-if="visit.billed" tone="green">
                          {{ t('ui.jobs.visitBilled') }}
                        </StatusTag>
                      </span>
                    </td>
                    <td :class="cn(TD, 'text-right')">
                      <Link route="visits.edit" :params="{ id: visit.id }" :class="LINK">
                        {{ t('ui.visits.edit') }}
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ul class="m-0 list-none p-0 md:hidden">
              <li v-for="visit in visits" :key="visit.id" :class="ROW">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    route="visits.schedule"
                    :qs="{ date: visit.startsAt.slice(0, 10) }"
                    :class="cn(LINK, 'text-[15px] font-semibold')"
                  >
                    {{ visitDay(visit) }}
                  </Link>
                  <span class="text-[13px] text-muted-foreground">
                    {{
                      [visitHours(visit), visit.technicians.join(', ')].filter(Boolean).join(' · ')
                    }}
                  </span>
                  <p
                    v-for="note in visit.notes"
                    :key="note.id"
                    class="m-0 text-[13px] text-muted-foreground"
                  >
                    {{ note.author }}: {{ note.body }}
                  </p>
                  <div v-if="visit.photoIds.length" class="flex flex-wrap gap-1.5">
                    <a
                      v-for="photoId in visit.photoIds"
                      :key="photoId"
                      :href="urlFor('visit_photos.show', { id: photoId })"
                      target="_blank"
                      rel="noopener"
                    >
                      <img
                        :src="urlFor('visit_photos.show', { id: photoId })"
                        :alt="t('ui.field.photo')"
                        loading="lazy"
                        :class="PHOTO"
                      />
                    </a>
                  </div>
                  <span class="flex flex-wrap gap-1.5">
                    <StatusTag v-if="visit.survey" tone="grey">{{
                      t('ui.visits.survey')
                    }}</StatusTag>
                    <StatusTag :tone="VISIT_TONES[visit.status] ?? 'grey'">
                      {{ t(`ui.visits.statuses.${visit.status}`) }}
                    </StatusTag>
                    <StatusTag v-if="visit.billed" tone="green">
                      {{ t('ui.jobs.visitBilled') }}
                    </StatusTag>
                  </span>
                </div>
                <Link
                  route="visits.edit"
                  :params="{ id: visit.id }"
                  :class="cn(LINK, 'flex min-h-11 items-center text-sm')"
                >
                  {{ t('ui.visits.edit') }}
                </Link>
              </li>
            </ul>
          </details>
          <p
            v-else
            class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4"
          >
            {{ t('ui.visits.none') }}
          </p>

          <!-- Left open when the Job was cancelled: Office marks each done (#153),
               its Charges all ticked; unticked ones become not done (ADR 0016) -->
          <Form
            v-for="visit in closable"
            :key="visit.id"
            v-slot="{ submit }"
            route="visits.mark_done"
            :params="{ id: visit.id }"
            class="flex flex-col gap-2 border-t border-border px-3.5 py-3 md:px-4"
          >
            <p :class="SUB">{{ visitTime(visit) }}</p>
            <label
              v-for="charge in visit.charges"
              :key="charge.id"
              class="flex min-h-11 items-center gap-2.5 text-sm md:min-h-0"
            >
              <input type="hidden" name="reviewed[]" :value="charge.id" />
              <input type="checkbox" name="done[]" :value="charge.id" checked class="size-4" />
              {{ charge.description }}
            </label>
            <Button
              type="button"
              variant="outline"
              :class="cn(BUTTON, 'self-start')"
              @click="askMarkDone(submit)"
            >
              {{ t('ui.visits.markDone') }}
            </Button>
          </Form>
        </ScreenSection>
      </template>

      <template #side>
        <ScreenSection v-if="job.description" :title="t('ui.jobs.description')">
          <p class="m-0 text-sm whitespace-pre-line">{{ job.description }}</p>
        </ScreenSection>

        <ScreenSection :title="t('ui.jobs.documents')" data-testid="job-documents">
          <div v-if="quotes.length" class="flex flex-col gap-2">
            <h3 :class="SUB">{{ t('ui.quotes.section') }}</h3>
            <div
              v-for="quote in quotes"
              :key="quote.id"
              class="flex items-center justify-between gap-2 text-sm"
              data-testid="quote"
            >
              <span class="min-w-0">
                <Link route="quotes.edit" :params="{ id: quote.id }" :class="LINK">
                  {{ quote.number }}
                </Link>
                <span class="text-muted-foreground"> · {{ formatMoney(quote.total) }}</span>
              </span>
              <StatusTag :tone="QUOTE_TONES[quote.status]">
                {{ t(`ui.quotes.statuses.${quote.status}`) }}
              </StatusTag>
            </div>
          </div>

          <div v-if="invoices.length" class="flex flex-col gap-2">
            <h3 :class="SUB">{{ t('ui.invoices.title') }}</h3>
            <div v-for="invoice in invoices" :key="invoice.id" class="flex flex-col gap-1">
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="min-w-0">
                  <Link route="invoices.edit" :params="{ id: invoice.id }" :class="LINK">
                    {{ invoice.number ?? t('ui.invoices.statuses.draft') }}
                  </Link>
                  <span class="text-muted-foreground">
                    <template v-if="invoice.advance"> · {{ t('ui.invoices.advance') }}</template>
                    · {{ formatMoney(invoice.total) }}
                  </span>
                </span>
                <StatusTag v-if="invoice.legacy" tone="grey">
                  {{ t('ui.invoices.legacy') }}
                </StatusTag>
                <StatusTag v-else :tone="INVOICE_TONES[invoice.status]">
                  {{ t(`ui.invoices.statuses.${invoice.status}`) }}
                </StatusTag>
              </div>
              <p
                v-if="invoice.deduction"
                class="m-0 text-[13px] text-muted-foreground"
                data-testid="advance-state"
              >
                {{
                  t(`ui.invoices.advanceStates.${invoice.deduction.state}`, {
                    amount: formatMoney(invoice.deduction.deducted),
                  })
                }}
                <template v-if="Number(invoice.deduction.credited)">
                  ·
                  {{
                    t('ui.invoices.advanceCredited', {
                      amount: formatMoney(invoice.deduction.credited),
                    })
                  }}
                </template>
              </p>
              <div
                v-for="note in invoice.creditNotes"
                :key="note.id"
                class="flex items-center justify-between gap-2 pl-3 text-sm"
                data-testid="job-credit-notes"
              >
                <span class="min-w-0">
                  <Link route="invoices.edit" :params="{ id: note.id }" :class="LINK">
                    {{
                      note.number
                        ? t('ui.invoices.creditNoteTitle', { number: note.number })
                        : t('ui.invoices.creditNoteDraftTitle')
                    }}
                  </Link>
                  <span class="text-muted-foreground"> · {{ formatMoney(note.total) }}</span>
                </span>
                <StatusTag :tone="INVOICE_TONES[note.status]">
                  {{ t(`ui.invoices.statuses.${note.status}`) }}
                </StatusTag>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <h3 :class="SUB">{{ t('ui.issuedDocuments.title') }}</h3>
            <div
              v-for="document in issuedDocuments"
              :key="document.id"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span class="min-w-0">
                <Link route="issued_documents.show" :params="{ id: document.id }" :class="LINK">
                  {{ document.number }}
                </Link>
                <span class="text-muted-foreground">
                  · {{ document.title }} · {{ formatDate(document.issuedOn) }}
                </span>
              </span>
              <StatusTag v-if="document.replaced" tone="grey">
                {{ t('ui.issuedDocuments.replaced') }}
              </StatusTag>
            </div>
            <p v-if="!issuedDocuments.length" class="m-0 text-sm text-muted-foreground">
              {{ t('ui.issuedDocuments.empty') }}
            </p>
            <div v-if="job.customer && workReportTemplates.length" class="flex flex-wrap gap-2">
              <Button
                v-for="template in workReportTemplates"
                :key="template.id"
                as-child
                variant="outline"
                :class="BUTTON"
              >
                <Link
                  route="issued_documents.create"
                  :qs="{ templateId: template.id, customerId: job.customer.id, jobId: job.id }"
                >
                  {{ t('ui.jobs.issueWorkReport', { name: template.name }) }}
                </Link>
              </Button>
            </div>
          </div>
        </ScreenSection>
      </template>

      <ScreenSection :title="t('ui.charges.title')" flush>
        <template v-if="canAddCharge" #actions>
          <Button variant="outline" :class="BUTTON" @click="chargeOpen = true">
            {{ t('ui.charges.add') }}
          </Button>
        </template>
        <template v-if="charges.length">
          <div class="hidden overflow-x-auto md:block">
            <table class="w-full border-collapse" data-testid="charges">
              <thead>
                <tr>
                  <th :class="cn(TH, 'min-w-44')">{{ t('ui.charges.description') }}</th>
                  <th :class="cn(TH, 'text-right')">{{ t('ui.charges.quantity') }}</th>
                  <th :class="cn(TH, 'text-right')">{{ t('ui.charges.unitPrice') }}</th>
                  <th :class="cn(TH, 'text-right')">{{ t('ui.charges.amount') }}</th>
                  <th :class="TH">{{ t('ui.charges.work') }}</th>
                  <th :class="TH">{{ t('ui.charges.state') }}</th>
                  <th :class="TH">
                    <span class="sr-only">{{ t('ui.charges.open') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="charge in charges" :key="charge.id">
                  <td :class="TD">
                    <button
                      v-if="charge.itemId !== null"
                      type="button"
                      aria-haspopup="dialog"
                      :class="cn(LINK, PREVIEW_LINK)"
                      @click="previewedItem = charge.itemId"
                    >
                      {{ charge.description }}
                    </button>
                    <template v-else>{{ charge.description }}</template>
                    <p class="m-0 text-[13px] text-muted-foreground">
                      {{ chargeSource(charge.visitId) }}
                    </p>
                  </td>
                  <td :class="cn(TD, 'text-right whitespace-nowrap')">
                    {{ quantity(charge.quantity) }} {{ charge.unit }}
                  </td>
                  <td :class="cn(TD, 'text-right whitespace-nowrap')">
                    {{ formatMoney(charge.unitPrice) }}
                  </td>
                  <td :class="cn(TD, 'text-right font-semibold whitespace-nowrap')">
                    {{ formatMoney(charge.amount) }}
                  </td>
                  <td :class="TD">
                    <StatusTag :tone="WORK_TONES[charge.workState]">
                      {{ t(`ui.charges.workStates.${charge.workState}`) }}
                    </StatusTag>
                  </td>
                  <td :class="TD">
                    <StatusTag :tone="CHARGE_TONES[charge.state]">
                      {{ t(`ui.charges.states.${charge.state}`) }}
                    </StatusTag>
                  </td>
                  <td :class="cn(TD, 'text-right whitespace-nowrap')">
                    <span class="inline-flex items-center gap-3">
                      <!-- Planned on the Job itself until Office confirms it used (ADR 0016) -->
                      <Form
                        v-if="charge.visitId === null && charge.workState === 'planned'"
                        route="charges.mark_done"
                        :params="{ id: charge.id }"
                      >
                        <Button type="submit" variant="outline" size="sm">
                          {{ t('ui.charges.confirmUsed') }}
                        </Button>
                      </Form>
                      <Link route="charges.edit" :params="{ id: charge.id }" :class="LINK">
                        {{ t('ui.charges.open') }}
                      </Link>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul class="m-0 list-none p-0 md:hidden">
            <li v-for="charge in charges" :key="charge.id" :class="cn(ROW, 'flex-col gap-2')">
              <div class="flex w-full items-start gap-2.5">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <button
                    v-if="charge.itemId !== null"
                    type="button"
                    aria-haspopup="dialog"
                    :class="cn(LINK, PREVIEW_LINK, 'self-start text-sm')"
                    @click="previewedItem = charge.itemId"
                  >
                    {{ charge.description }}
                  </button>
                  <span v-else class="text-sm">{{ charge.description }}</span>
                  <span class="text-[13px] text-muted-foreground">
                    {{ chargeSource(charge.visitId) }} ·
                    {{
                      t('ui.charges.quantityAtPrice', {
                        quantity: `${quantity(charge.quantity)} ${charge.unit ?? ''}`.trim(),
                        price: formatMoney(charge.unitPrice),
                      })
                    }}
                  </span>
                  <span class="flex flex-wrap gap-1.5">
                    <StatusTag :tone="WORK_TONES[charge.workState]">
                      {{ t(`ui.charges.workStates.${charge.workState}`) }}
                    </StatusTag>
                    <StatusTag :tone="CHARGE_TONES[charge.state]">
                      {{ t(`ui.charges.states.${charge.state}`) }}
                    </StatusTag>
                  </span>
                </div>
                <span class="text-[15px] font-bold whitespace-nowrap">
                  {{ formatMoney(charge.amount) }}
                </span>
              </div>
              <div class="flex items-center gap-4">
                <Form
                  v-if="charge.visitId === null && charge.workState === 'planned'"
                  route="charges.mark_done"
                  :params="{ id: charge.id }"
                >
                  <Button type="submit" variant="outline" :class="BUTTON">
                    {{ t('ui.charges.confirmUsed') }}
                  </Button>
                </Form>
                <Link
                  route="charges.edit"
                  :params="{ id: charge.id }"
                  :class="cn(LINK, 'flex min-h-11 items-center text-sm')"
                >
                  {{ t('ui.charges.open') }}
                </Link>
              </div>
            </li>
          </ul>
        </template>
        <p
          v-else
          class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4"
        >
          {{ t('ui.charges.none') }}
        </p>
      </ScreenSection>

      <ScreenSection
        v-if="summary.hours.length || summary.items.length"
        :title="t('ui.jobs.summary')"
        flush
        data-testid="charge-summary"
      >
        <p class="m-0 px-3.5 pb-2 text-[13px] text-muted-foreground md:px-4">
          {{ t('ui.jobs.summaryHint') }}
        </p>
        <ul class="m-0 list-none p-0">
          <li
            v-for="row in summary.hours"
            :key="row.key"
            class="border-t border-border px-3.5 md:px-4"
          >
            <details class="group">
              <summary :class="cn(SUMMARY_TOGGLE, 'flex-wrap justify-between py-2 text-sm')">
                <span class="flex items-center gap-2">
                  <ChevronDown
                    :size="16"
                    aria-hidden="true"
                    class="shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0"
                  />
                  <span class="font-semibold">{{ row.worker ?? '—' }}</span>
                  <span class="text-muted-foreground">{{ row.labourRate ?? '—' }}</span>
                </span>
                <span class="text-muted-foreground">{{ figures(row, row.unit) }}</span>
              </summary>
              <p
                v-for="visit in row.visits"
                :key="visit.visitId ?? 0"
                class="m-0 pb-2 pl-6 text-[13px] text-muted-foreground"
              >
                {{ chargeSource(visit.visitId, true) }}: {{ figures(visit, row.unit, false) }}
              </p>
            </details>
          </li>
          <li
            v-for="row in summary.items"
            :key="row.itemId"
            class="border-t border-border px-3.5 md:px-4"
          >
            <details class="group">
              <summary :class="cn(SUMMARY_TOGGLE, 'flex-wrap justify-between py-2 text-sm')">
                <span class="flex items-center gap-2">
                  <ChevronDown
                    :size="16"
                    aria-hidden="true"
                    class="shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0"
                  />
                  <span class="font-semibold">{{ row.item }}</span>
                </span>
                <span class="text-muted-foreground">{{ figures(row, row.unit) }}</span>
              </summary>
              <p
                v-for="visit in row.visits"
                :key="visit.visitId ?? 0"
                class="m-0 pb-2 pl-6 text-[13px] text-muted-foreground"
              >
                {{ chargeSource(visit.visitId, true) }}: {{ figures(visit, row.unit, false) }}
              </p>
            </details>
          </li>
        </ul>
      </ScreenSection>
    </EntityScreen>

    <!-- The draft Invoice from the Charges: its options first -->
    <Dialog v-model:open="draftOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')" :aria-describedby="undefined">
        <DialogTitle>{{ t('ui.invoices.fromCharges') }}</DialogTitle>
        <Form
          v-slot="{ errors: draftErrors, processing }"
          route="invoices.store_from_job"
          :params="{ id: job.id }"
          class="flex flex-col gap-4"
        >
          <!-- Sent either way, so the choice is always explicit -->
          <input type="hidden" name="combine" :value="combine ? 'true' : 'false'" />
          <FormField
            id="invoice-organise-by"
            v-slot="field"
            :label="t('ui.invoices.organiseBy')"
            :hint="t('ui.invoices.organiseByHint')"
          >
            <NativeSelect
              :id="field.id"
              v-model="organiseBy"
              name="organiseBy"
              :aria-describedby="field.describedBy"
            >
              <option v-for="option in ORGANISE_BY" :key="option" :value="option">
                {{ t(`ui.invoices.organiseOptions.${option}`) }}
              </option>
            </NativeSelect>
          </FormField>
          <div class="flex flex-col gap-1.5">
            <label class="flex min-h-11 items-center gap-2.5 text-sm font-medium md:min-h-0">
              <input
                v-model="combine"
                type="checkbox"
                class="size-4"
                aria-describedby="invoice-combine-hint"
              />
              {{ t('ui.invoices.combineCharges') }}
            </label>
            <p id="invoice-combine-hint" class="m-0 text-[13px] text-muted-foreground">
              {{ t('ui.invoices.combineChargesHint') }}
            </p>
          </div>
          <FormField
            id="invoice-up-to"
            v-slot="field"
            :label="t('ui.invoices.upTo')"
            :hint="t('ui.invoices.upToHint')"
            :error="draftErrors.upTo"
          >
            <Input
              :id="field.id"
              name="upTo"
              type="date"
              class="h-11 md:h-9"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="draftOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="processing">
              {{ t('ui.invoices.fromCharges') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <!-- Closing shows what it leaves behind, which never stops it: Office decides (ADR 0015) -->
    <Dialog v-model:open="closeOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.jobs.close') }}</DialogTitle>
        <DialogDescription>
          {{ left.length ? t('ui.jobs.leftToCloseHint') : t('ui.jobs.nothingLeft') }}
        </DialogDescription>
        <ul
          v-if="left.length"
          class="m-0 flex list-disc flex-col gap-1 pl-5 text-sm"
          data-testid="left-to-close"
        >
          <li v-for="[key, count] in left" :key="key">
            {{ t(`ui.jobs.leftToClose.${key}`, { count }) }}
          </li>
        </ul>
        <Form
          v-slot="{ processing }"
          route="jobs.close"
          :params="{ id: job.id }"
          @success="closeOpen = false"
        >
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="closeOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="processing">
              {{ t('ui.jobs.close') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <!-- Another cost on the Job: a call-out, a contractor's day, materials bought -->
    <Dialog v-model:open="chargeOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.charges.add') }}</DialogTitle>
        <DialogDescription>{{ t('ui.charges.addHint') }}</DialogDescription>
        <Button
          v-if="callOutFee"
          type="button"
          variant="outline"
          :class="cn(BUTTON, 'self-start')"
          @click="fillCallOut(callOutFee)"
        >
          {{ t('ui.charges.useCallOut') }}
        </Button>
        <Form
          v-slot="{ processing, errors }"
          route="charges.store"
          :params="{ id: job.id }"
          class="flex flex-col gap-4"
          @success="chargeAdded"
        >
          <FormField
            id="new-charge-description"
            v-slot="field"
            :label="t('ui.charges.description')"
            :error="errors.description"
          >
            <Input
              :id="field.id"
              v-model="newCharge.description"
              name="description"
              class="h-11 md:h-9"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <div class="grid grid-cols-2 gap-3">
            <FormField
              id="new-charge-quantity"
              v-slot="field"
              :label="t('ui.charges.quantity')"
              :error="errors.quantity"
            >
              <Input
                :id="field.id"
                v-model="newCharge.quantity"
                name="quantity"
                inputmode="decimal"
                class="h-11 md:h-9"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
            <FormField
              id="new-charge-unit"
              v-slot="field"
              :label="t('ui.charges.unit')"
              :error="errors.unit"
            >
              <Input
                :id="field.id"
                v-model="newCharge.unit"
                name="unit"
                class="h-11 md:h-9"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </div>
          <FormField
            id="new-charge-price"
            v-slot="field"
            :label="t('ui.charges.unitPrice')"
            :error="errors.unitPrice"
          >
            <Input
              :id="field.id"
              v-model="newCharge.unitPrice"
              name="unitPrice"
              inputmode="decimal"
              class="h-11 md:h-9"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="new-charge-vat"
            v-slot="field"
            :label="t('ui.charges.vatKind')"
            :error="errors.vatKind"
          >
            <NativeSelect
              :id="field.id"
              v-model="newCharge.vatKind"
              name="vatKind"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            >
              <option v-for="kind in LINE_KINDS" :key="kind" :value="kind">
                {{ t(`ui.charges.vatKinds.${kind}`) }}
              </option>
            </NativeSelect>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="chargeOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="processing">
              {{ t('ui.charges.add') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      v-model:open="markDoneOpen"
      :title="t('ui.visits.markDone')"
      :description="t('ui.visits.markDoneConfirm')"
      :confirm-label="t('ui.visits.markDone')"
      @confirm="markDone?.()"
    />

    <ItemPreview v-model:item-id="previewedItem" />
  </AppLayout>
</template>
