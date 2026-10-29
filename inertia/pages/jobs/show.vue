<script setup lang="ts">
import type { QuoteStatus } from '@shared/quotes'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, formatMoney, t } from '~/i18n'
import { urlFor } from '~/client'
import { amountForInput } from '@shared/money'
import type { ChargeState, WorkState } from '@shared/charges'
import type { AdvanceState } from '@shared/advances'
import { LINE_KINDS } from '@shared/vat'
import { takesNewWork, type JobIndicators, type JobStatus } from '@shared/jobs'
import { isOpenVisit } from '@shared/visits'
import { DEFAULT_ORGANISE_BY, ORGANISE_BY } from '@shared/invoice_sections'
import { computed, ref } from 'vue'
import JobIndicatorTags from '~/components/job_indicator_tags.vue'
import IssuedDocumentList, { type IssuedDocumentRow } from '~/components/issued_document_list.vue'

const confirm = (message: string) => window.confirm(message)
// A draft from the Charges combines alike ones unless unticked (ADR 0017)
const combine = ref(true)
type WorkTotals = { planned: string; done: string; notDone: string }
type SummaryRow = WorkTotals & { visits: (WorkTotals & { visitId: number | null })[] }
// The new cost's fields, pre-filled with the call-out fee on request
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
const quantity = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')

const props = defineProps<{
  quotes: { id: number; number: string; status: QuoteStatus; total: string }[]
  canWriteQuote: boolean
  invoices: {
    id: number
    number: string | null
    status: string
    total: string
    advance: boolean
    legacy: boolean
    deduction: { deducted: string; credited: string; state: AdvanceState } | null
    // Its Credit Notes, drafts included (ADR 0014)
    creditNotes: { id: number; number: string | null; status: string; total: string }[]
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
  timeAndMaterials: { total: string; billed: string; inDraft: string; lines: number }
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

// A closed or cancelled Job takes no new Visits, Charges or Quotes
const active = computed(() => takesNewWork(props.job.status))
const left = computed(() =>
  Object.entries(props.leftToClose ?? {}).filter(([, count]) => count > 0)
)
// Cancelling leaves open Visits frozen until Office marks them done (#153)
const visitTime = (visit: { startsAt: string; endsAt: string }) =>
  `${formatDate(visit.startsAt)} ${visit.startsAt.slice(11, 16)}–${visit.endsAt.slice(11, 16)}`
// Where a summary figure comes from: a Visit by its time, or the Job itself
function chargeSource(visitId: number | null) {
  if (visitId === null) return t('ui.charges.onJob')
  const visit = props.visits.find((candidate) => candidate.id === visitId)
  return visit ? visitTime(visit) : ''
}
// The summary's columns: each figure and the work state it totals
const WORK_COLUMNS = [
  ['planned', 'planned'],
  ['done', 'done'],
  ['notDone', 'not_done'],
] as const
function confirmCancel() {
  const open = props.visits.filter((visit) => isOpenVisit(visit.status))
  return confirm(
    open.length
      ? t('ui.jobs.cancelConfirmOpenVisits', {
          number: props.job.number,
          visits: open
            .map((visit) => `• ${visitTime(visit)} (${t(`ui.visits.statuses.${visit.status}`)})`)
            .join('\n'),
        })
      : t('ui.jobs.cancelConfirm', { number: props.job.number })
  )
}
</script>

<template>
  <AppLayout>
    <Page :title="`${job.number} · ${job.title}`">
      <template #actions>
        <Link
          v-if="job.status !== 'cancelled'"
          route="jobs.edit"
          :params="{ id: job.id }"
          class="btn btn--secondary btn--sm"
        >
          <Pencil :size="15" /> {{ t('ui.common.edit') }}
        </Link>
      </template>

      <Section :title="t('ui.jobs.detailsSection')">
        <dl class="details">
          <dt>{{ t('ui.jobs.status') }}</dt>
          <dd>
            <span class="tag">{{ t(`ui.jobs.statuses.${job.status}`) }}</span>
            <JobIndicatorTags v-if="job.indicators" :indicators="job.indicators" />
            <span v-if="job.cancelledAt" class="field__hint">
              · {{ t('ui.jobs.cancelledOn', { date: formatDate(job.cancelledAt) }) }}
            </span>
            <span v-if="job.closedAt" class="field__hint">
              · {{ t('ui.jobs.closedOn', { date: formatDate(job.closedAt) }) }}
            </span>
          </dd>
          <dt>{{ t('ui.jobs.workCategory') }}</dt>
          <dd>{{ t(`ui.jobs.workCategories.${job.workCategory}`) }}</dd>
          <dt>{{ t('ui.jobs.customer') }}</dt>
          <dd>
            <Link
              v-if="job.customer"
              route="customers.show"
              :params="{ id: job.customer.id }"
              class="il"
            >
              {{ job.customer.displayName }}
            </Link>
          </dd>
          <template v-if="job.site">
            <dt>{{ t('ui.jobs.site') }}</dt>
            <dd>
              <Link route="sites.show" :params="{ id: job.site.id }" class="il">
                {{ job.site.summary }}
              </Link>
            </dd>
          </template>
          <dt>{{ t('ui.jobs.createdAt') }}</dt>
          <dd>{{ formatDate(job.createdAt) }}</dd>
          <template v-if="job.description">
            <dt>{{ t('ui.jobs.description') }}</dt>
            <dd :style="{ whiteSpace: 'pre-line' }">{{ job.description }}</dd>
          </template>
        </dl>
      </Section>

      <Section v-if="timeAndMaterials.lines" :title="t('ui.jobs.timeAndMaterials')">
        <p :style="{ margin: 0 }">
          <strong>{{ formatMoney(timeAndMaterials.total) }}</strong>
          <span class="field__hint"> · {{ t('ui.jobs.timeAndMaterialsHint') }}</span>
        </p>
        <p :style="{ margin: 0 }" data-testid="billed">
          {{ t('ui.jobs.billed', { amount: formatMoney(timeAndMaterials.billed) }) }}
          <template v-if="Number(timeAndMaterials.inDraft)">
            · {{ t('ui.jobs.inDraft', { amount: formatMoney(timeAndMaterials.inDraft) }) }}
          </template>
        </p>
      </Section>

      <Section :title="t('ui.visits.title')">
        <!-- Collapsed by default, a long Job having many Visits (#178), unless
             one waits for Office to mark it done (#153) -->
        <details
          v-if="visits.length"
          :open="visits.some((visit) => visit.closableByOffice)"
          data-testid="visits"
        >
          <summary data-testid="visit-progress">
            {{ t('ui.jobs.progress', { done: progress.done, total: progress.total }) }}
            <template v-if="progress.cancelled">
              · {{ t('ui.jobs.progressCancelled', { count: progress.cancelled }) }}
            </template>
            <template v-if="progress.next">
              · {{ t('ui.jobs.progressNext', { when: visitTime(progress.next) }) }}
            </template>
          </summary>
          <table class="table">
            <tbody>
              <tr v-for="visit in visits" :key="visit.id">
                <td>
                  <Link
                    route="visits.schedule"
                    :qs="{ date: visit.startsAt.slice(0, 10) }"
                    class="il"
                  >
                    {{ visitTime(visit) }}
                  </Link>
                  <Link
                    route="visits.edit"
                    :params="{ id: visit.id }"
                    class="btn btn--ghost btn--sm"
                  >
                    {{ t('ui.visits.edit') }}
                  </Link>
                </td>
                <td>
                  {{ visit.technicians.join(', ') }}
                  <div v-for="note in visit.notes" :key="note.id" class="field__hint">
                    {{ note.author }}: {{ note.body }}
                  </div>
                  <div v-if="visit.photoIds.length" class="field-photos">
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
                      />
                    </a>
                  </div>
                </td>
                <td>
                  <span v-if="visit.survey" class="tag">{{ t('ui.visits.survey') }}</span>
                  <span class="tag">{{ t(`ui.visits.statuses.${visit.status}`) }}</span>
                  <span v-if="visit.billed" class="tag">{{ t('ui.jobs.visitBilled') }}</span>
                  <Form
                    v-if="visit.closableByOffice"
                    route="visits.mark_done"
                    :params="{ id: visit.id }"
                    :on-before="() => confirm(t('ui.visits.markDoneConfirm'))"
                  >
                    <!-- Its Charges, all ticked: unticked ones become not done (ADR 0016) -->
                    <label
                      v-for="charge in visit.charges"
                      :key="charge.id"
                      :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
                    >
                      <input type="hidden" name="reviewed[]" :value="charge.id" />
                      <input type="checkbox" name="done[]" :value="charge.id" checked />
                      {{ charge.description }}
                    </label>
                    <button type="submit" class="btn btn--ghost btn--sm">
                      {{ t('ui.visits.markDone') }}
                    </button>
                  </Form>
                </td>
              </tr>
            </tbody>
          </table>
        </details>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.visits.none') }}</p>
        <div v-if="active">
          <Link route="visits.create" :params="{ id: job.id }" class="btn btn--secondary btn--sm">
            {{ t('ui.visits.plan') }}
          </Link>
        </div>
      </Section>

      <Section
        v-if="summary.hours.length || summary.items.length"
        :title="t('ui.jobs.summary')"
        data-testid="charge-summary"
      >
        <p class="field__hint" :style="{ margin: 0 }">{{ t('ui.jobs.summaryHint') }}</p>
        <table v-if="summary.hours.length" class="table">
          <thead>
            <tr>
              <th>{{ t('ui.charges.worker') }}</th>
              <th>{{ t('ui.charges.labourRate') }}</th>
              <th v-for="[, state] in WORK_COLUMNS" :key="state">
                {{ t(`ui.charges.workStates.${state}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.hours" :key="row.key">
              <td>
                <details>
                  <summary>{{ row.worker ?? '—' }}</summary>
                  <div v-for="visit in row.visits" :key="visit.visitId ?? 0" class="field__hint">
                    {{ chargeSource(visit.visitId) }}:
                    <template v-for="[key, state] in WORK_COLUMNS" :key="state">
                      <template v-if="Number(visit[key])">
                        {{ t(`ui.charges.workStates.${state}`) }} {{ quantity(visit[key]) }}
                        {{ row.unit }}
                      </template>
                    </template>
                  </div>
                </details>
              </td>
              <td>{{ row.labourRate ?? '—' }}</td>
              <td v-for="[key] in WORK_COLUMNS" :key="key">
                {{ quantity(row[key]) }} {{ row.unit }}
              </td>
            </tr>
          </tbody>
        </table>
        <table v-if="summary.items.length" class="table">
          <thead>
            <tr>
              <th>{{ t('ui.charges.item') }}</th>
              <th v-for="[, state] in WORK_COLUMNS" :key="state">
                {{ t(`ui.charges.workStates.${state}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.items" :key="row.itemId">
              <td>
                <details>
                  <summary>{{ row.item }}</summary>
                  <div v-for="visit in row.visits" :key="visit.visitId ?? 0" class="field__hint">
                    {{ chargeSource(visit.visitId) }}:
                    <template v-for="[key, state] in WORK_COLUMNS" :key="state">
                      <template v-if="Number(visit[key])">
                        {{ t(`ui.charges.workStates.${state}`) }} {{ quantity(visit[key]) }}
                        {{ row.unit }}
                      </template>
                    </template>
                  </div>
                </details>
              </td>
              <td v-for="[key] in WORK_COLUMNS" :key="key">
                {{ quantity(row[key]) }} {{ row.unit }}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section :title="t('ui.charges.title')">
        <table v-if="charges.length" class="table" data-testid="charges">
          <thead>
            <tr>
              <th>{{ t('ui.charges.description') }}</th>
              <th>{{ t('ui.charges.quantity') }}</th>
              <th>{{ t('ui.charges.unitPrice') }}</th>
              <th>{{ t('ui.charges.amount') }}</th>
              <th>{{ t('ui.charges.work') }}</th>
              <th>{{ t('ui.charges.state') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="charge in charges" :key="charge.id">
              <td>
                {{ charge.description }}
                <div class="field__hint">
                  {{
                    charge.visitId
                      ? t('ui.charges.visit', {
                          date: formatDate(
                            visits.find((visit) => visit.id === charge.visitId)?.startsAt ?? ''
                          ),
                        })
                      : t('ui.charges.onJob')
                  }}
                </div>
              </td>
              <td>{{ quantity(charge.quantity) }} {{ charge.unit }}</td>
              <td>{{ formatMoney(charge.unitPrice) }}</td>
              <td>{{ formatMoney(charge.amount) }}</td>
              <td>
                <span class="tag">{{ t(`ui.charges.workStates.${charge.workState}`) }}</span>
              </td>
              <td>
                <span class="tag">{{ t(`ui.charges.states.${charge.state}`) }}</span>
              </td>
              <td class="table__actions">
                <!-- Planned on the Job itself until Office confirms it used (ADR 0016) -->
                <Form
                  v-if="charge.visitId === null && charge.workState === 'planned'"
                  route="charges.mark_done"
                  :params="{ id: charge.id }"
                >
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.charges.confirmUsed') }}
                  </button>
                </Form>
                <Link
                  route="charges.edit"
                  :params="{ id: charge.id }"
                  class="btn btn--ghost btn--sm"
                >
                  {{ t('ui.charges.open') }}
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.charges.none') }}</p>
        <Form
          v-if="active"
          v-slot="{ processing, errors }"
          route="charges.store"
          :params="{ id: job.id }"
          class="form"
          @success="newCharge = blankCharge()"
        >
          <p class="field__hint" :style="{ margin: 0 }">
            {{ t('ui.charges.addHint') }}
            <button
              v-if="callOutFee"
              type="button"
              class="btn btn--ghost btn--sm"
              @click="fillCallOut(callOutFee)"
            >
              {{ t('ui.charges.useCallOut') }}
            </button>
          </p>
          <div class="field">
            <label class="field__label" for="new-charge-description">{{
              t('ui.charges.description')
            }}</label>
            <input
              id="new-charge-description"
              v-model="newCharge.description"
              name="description"
              class="field__input"
            />
            <span v-if="errors.description" class="field__error">{{ errors.description }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-quantity">{{
              t('ui.charges.quantity')
            }}</label>
            <input
              id="new-charge-quantity"
              v-model="newCharge.quantity"
              name="quantity"
              inputmode="decimal"
              class="field__input"
            />
            <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-unit">{{ t('ui.charges.unit') }}</label>
            <input id="new-charge-unit" v-model="newCharge.unit" name="unit" class="field__input" />
            <span v-if="errors.unit" class="field__error">{{ errors.unit }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-price">{{
              t('ui.charges.unitPrice')
            }}</label>
            <input
              id="new-charge-price"
              v-model="newCharge.unitPrice"
              name="unitPrice"
              inputmode="decimal"
              class="field__input"
            />
            <span v-if="errors.unitPrice" class="field__error">{{ errors.unitPrice }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-vat">{{ t('ui.charges.vatKind') }}</label>
            <select
              id="new-charge-vat"
              v-model="newCharge.vatKind"
              name="vatKind"
              class="field__input"
            >
              <option v-for="kind in LINE_KINDS" :key="kind" :value="kind">
                {{ t(`ui.charges.vatKinds.${kind}`) }}
              </option>
            </select>
            <span v-if="errors.vatKind" class="field__error">{{ errors.vatKind }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
            {{ t('ui.charges.add') }}
          </button>
        </Form>
      </Section>

      <Section v-if="quotes.length || canWriteQuote" :title="t('ui.quotes.section')">
        <ul v-if="quotes.length" :style="{ margin: '0 0 8px', paddingLeft: '18px' }">
          <li v-for="quote in quotes" :key="quote.id" data-testid="quote">
            <Link route="quotes.edit" :params="{ id: quote.id }" class="il mono">
              {{ quote.number }}
            </Link>
            · {{ t(`ui.quotes.statuses.${quote.status}`) }} · {{ formatMoney(quote.total) }}
          </li>
        </ul>
        <Link
          v-if="canWriteQuote"
          route="quotes.create"
          :params="{ id: job.id }"
          class="btn btn--secondary btn--sm"
        >
          {{ t('ui.quotes.new') }}
        </Link>
      </Section>

      <Section :title="t('ui.invoices.title')">
        <p v-if="invoices.length" :style="{ margin: '0 0 8px' }" data-testid="invoiced-so-far">
          {{
            t('ui.invoices.invoicedSoFarOf', {
              amount: formatMoney(invoicedSoFar.amount),
              of: formatMoney(invoicedSoFar.of),
            })
          }}
          <span v-if="invoicedSoFar.quoted" class="field__hint" data-testid="quoted-total">
            · {{ t('ui.invoices.quotedTotal', { amount: formatMoney(invoicedSoFar.quoted) }) }}
          </span>
        </p>
        <ul v-if="invoices.length" :style="{ margin: 0, paddingLeft: '18px' }">
          <li v-for="invoice in invoices" :key="invoice.id">
            <Link route="invoices.edit" :params="{ id: invoice.id }" class="il">
              {{ invoice.number ?? t('ui.invoices.statuses.draft') }}
            </Link>
            <span v-if="invoice.advance"> · {{ t('ui.invoices.advance') }}</span>
            ·
            {{
              invoice.legacy ? t('ui.invoices.legacy') : t(`ui.invoices.statuses.${invoice.status}`)
            }}
            · {{ formatMoney(invoice.total) }}
            <span v-if="invoice.deduction" data-testid="advance-state">
              ·
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
            </span>
            <ul
              v-if="invoice.creditNotes.length"
              :style="{ margin: 0, paddingLeft: '18px' }"
              data-testid="job-credit-notes"
            >
              <li v-for="note in invoice.creditNotes" :key="note.id">
                <Link route="invoices.edit" :params="{ id: note.id }" class="il">
                  {{
                    note.number
                      ? t('ui.invoices.creditNoteTitle', { number: note.number })
                      : t('ui.invoices.creditNoteDraftTitle')
                  }}
                </Link>
                · {{ t(`ui.invoices.statuses.${note.status}`) }} · {{ formatMoney(note.total) }}
              </li>
            </ul>
          </li>
        </ul>
        <Form
          v-if="canInvoiceAdvance"
          route="invoices.store_advance"
          :params="{ id: job.id }"
          :style="{ marginBottom: '8px' }"
        >
          <button type="submit" class="btn btn--ghost btn--sm">
            {{ t('ui.invoices.newAdvance') }}
          </button>
        </Form>
        <Form
          v-if="canInvoice"
          v-slot="{ errors: draftErrors }"
          route="invoices.store_from_job"
          :params="{ id: job.id }"
        >
          <!-- Sent either way, so the choice is always explicit -->
          <input type="hidden" name="combine" :value="combine ? 'true' : 'false'" />
          <div class="field">
            <label class="field__label" for="invoice-organise-by">
              {{ t('ui.invoices.organiseBy') }}
            </label>
            <select
              id="invoice-organise-by"
              name="organiseBy"
              class="field__input"
              :style="{ maxWidth: '360px' }"
            >
              <option
                v-for="option in ORGANISE_BY"
                :key="option"
                :value="option"
                :selected="option === DEFAULT_ORGANISE_BY"
              >
                {{ t(`ui.invoices.organiseOptions.${option}`) }}
              </option>
            </select>
            <span class="field__hint">{{ t('ui.invoices.organiseByHint') }}</span>
          </div>
          <div class="field">
            <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
              <input v-model="combine" type="checkbox" />
              {{ t('ui.invoices.combineCharges') }}
            </label>
            <span class="field__hint">{{ t('ui.invoices.combineChargesHint') }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="invoice-up-to">{{ t('ui.invoices.upTo') }}</label>
            <input
              id="invoice-up-to"
              name="upTo"
              type="date"
              class="field__input"
              :style="{ maxWidth: '200px' }"
            />
            <span class="field__hint">{{ t('ui.invoices.upToHint') }}</span>
            <span v-if="draftErrors.upTo" class="field__error">{{ draftErrors.upTo }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.invoices.fromCharges') }}
          </button>
        </Form>
        <Link
          route="legacy_invoices.create"
          :qs="{ jobId: job.id }"
          class="btn btn--ghost btn--sm"
          :style="{ marginTop: '8px' }"
        >
          {{ t('ui.legacyInvoices.new') }}
        </Link>
      </Section>

      <Section :title="t('ui.issuedDocuments.title')" data-testid="job-documents">
        <IssuedDocumentList :documents="issuedDocuments" :show-customer="false" />
        <div v-if="job.customer && workReportTemplates.length">
          <Link
            v-for="template in workReportTemplates"
            :key="template.id"
            route="issued_documents.create"
            :qs="{ templateId: template.id, customerId: job.customer.id, jobId: job.id }"
            class="btn btn--secondary btn--sm"
          >
            {{ t('ui.jobs.issueWorkReport', { name: template.name }) }}
          </Link>
        </div>
      </Section>

      <Section v-if="active" :title="t('ui.jobs.closeSection')">
        <!-- What is left never stops closing: Office decides (ADR 0015) -->
        <div v-if="left.length" data-testid="left-to-close">
          <p class="field__hint" :style="{ margin: 0 }">{{ t('ui.jobs.leftToCloseHint') }}</p>
          <ul :style="{ margin: '0 0 8px', paddingLeft: '18px' }">
            <li v-for="[key, count] in left" :key="key">
              {{ t(`ui.jobs.leftToClose.${key}`, { count }) }}
            </li>
          </ul>
        </div>
        <p v-else class="field__hint" :style="{ margin: '0 0 8px' }">
          {{ t('ui.jobs.nothingLeft') }}
        </p>
        <Form route="jobs.close" :params="{ id: job.id }" :style="{ marginBottom: '8px' }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.jobs.close') }}
          </button>
        </Form>
        <Form route="jobs.cancel" :params="{ id: job.id }" :on-before="confirmCancel">
          <button type="submit" class="btn btn--ghost btn--sm">{{ t('ui.jobs.cancel') }}</button>
        </Form>
      </Section>
      <Section v-else-if="job.status === 'closed'">
        <Form route="jobs.reopen" :params="{ id: job.id }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.jobs.reopen') }}
          </button>
        </Form>
      </Section>
    </Page>
  </AppLayout>
</template>
