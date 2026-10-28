<script setup lang="ts">
import type { QuoteStatus } from '@shared/quotes'
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { ArrowDown, ArrowUp, FileText, Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { urlFor } from '~/client'
import { formatMoney, formatUnitPrice, t } from '~/i18n'
import { amountForInput, lineTotal, parseAmount, parseQuantity } from '@shared/money'
import { lineKindOf, needsSignificantGoodSplit, type LineKind } from '@shared/vat'
import { invoiceTotals } from '@shared/invoice_totals'
import { formatDate } from '@shared/dates'

type Kind = 'item' | 'labour' | 'call_out' | 'text'

type Line = {
  key: number
  kind: Kind
  itemId: number | null
  labourRateId: number | null
  description: string
  quantity: string
  unit: string | null
  unitPrice: string
  vatCodeId: number | null
  significantGood: boolean
}

const props = defineProps<{
  job: { id: number; number: string; title: string; status: string; customer: string }
  quote: {
    status: QuoteStatus
    sentAt: string | null
    notes: string | null
    validityDays: number | null
    issuedOn: string | null
    totals: { total: string }
    lines: {
      id: number
      // Charges imported from this line so far
      imported: number
      vatCodeId: number | null
      kind: Kind
      itemId: number | null
      labourRateId: number | null
      description: string
      quantity: string | null
      unit: string | null
      unitPrice: string | null
      lineTotal: string | null
      significantGood: boolean
    }[]
  } | null
  editable: boolean
  // A draft with priced lines can be sent; sent, or still a draft, decided
  sendable: boolean
  decidable: boolean
  // An accepted Quote on a Job not cancelled: its lines can become Charges
  importable: boolean
  openVisits: { id: number; startsAt: string; technicianIds: number[] }[]
  technicians: { id: number; name: string }[]
  labourRates: { id: number; name: string; hourlyPrice: string }[]
  callOutFee: string | null
  vatCodes: { id: number; name: string; rate: string; natura: string | null }[]
  // New lines follow the Job's default VAT rules
  vatDefaults: Record<LineKind, number>
}>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

let nextKey = 0
const trim = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')

function linesFromProps() {
  return (props.quote?.lines ?? []).map((line) => ({
    key: nextKey++,
    kind: line.kind,
    itemId: line.itemId,
    labourRateId: line.labourRateId,
    description: line.description,
    quantity: line.quantity ? trim(line.quantity) : '',
    unit: line.unit,
    unitPrice: line.unitPrice ? amountForInput(line.unitPrice) : '',
    vatCodeId: line.vatCodeId,
    significantGood: line.significantGood,
  }))
}

const codes = computed(() => new Map(props.vatCodes.map((code) => [code.id, code])))
function splitWarning(line: Line) {
  const code = line.vatCodeId ? codes.value.get(line.vatCodeId) : undefined
  return code ? needsSignificantGoodSplit(code, line.significantGood) : false
}

const lines = reactive<Line[]>(linesFromProps())
const notes = ref(props.quote?.notes ?? '')
// A number input's v-model gives numbers; '' while empty
const validityDays = ref<number | ''>(props.quote?.validityDays ?? '')

/**
 * What the server has, in the same shape as the editor's state, so unsaved
 * changes can be detected.
 */
const snapshot = () =>
  JSON.stringify({
    notes: notes.value,
    validityDays: String(validityDays.value),
    lines: lines.map(({ key: _key, ...line }) => line),
  })
const saved = ref(snapshot())
const dirty = computed(() => snapshot() !== saved.value)

/**
 * After a save, or when someone else decided the Quote, show what the
 * server has rather than stale local edits.
 */
watch(
  () => props.quote,
  () => {
    if (Object.keys(errors.value).length) return
    lines.splice(0, lines.length, ...linesFromProps())
    notes.value = props.quote?.notes ?? ''
    validityDays.value = props.quote?.validityDays ?? ''
    saved.value = snapshot()
  }
)
const processing = ref(false)
const labourRateId = ref<number | ''>('')

function totalOf(line: Line) {
  const quantity = parseQuantity(line.quantity)
  const price = parseAmount(line.unitPrice)
  if (line.kind === 'text' || !quantity || !price) return null
  return lineTotal(quantity.toFixed(), price.toFixed())
}

const totals = computed(() =>
  invoiceTotals(
    lines.flatMap((line) => {
      const quantity = parseQuantity(line.quantity)
      const price = parseAmount(line.unitPrice)
      const code = line.vatCodeId ? codes.value.get(line.vatCodeId) : undefined
      if (line.kind === 'text' || !quantity || !price || !code) return []
      return [
        {
          quantity: quantity.toFixed(),
          unitPrice: price.toFixed(),
          vatRate: code.rate,
          natura: code.natura,
        },
      ]
    })
  )
)

const vatLabel = (row: { vatRate: string; natura: string | null }) =>
  row.natura ?? `${trim(row.vatRate)}%`

function addItem(item: PickedItem & { resalePrice?: string; vatCodeId?: number }) {
  lines.push({
    key: nextKey++,
    kind: 'item',
    itemId: item.id,
    labourRateId: null,
    description: item.description,
    quantity: '1',
    unit: item.unit,
    unitPrice: item.resalePrice ? amountForInput(item.resalePrice) : '',
    vatCodeId: props.vatDefaults[lineKindOf(item)],
    significantGood: item.significantGood,
  })
}

function addLabour() {
  const rate = props.labourRates.find((r) => r.id === labourRateId.value)
  if (!rate) return
  lines.push({
    key: nextKey++,
    kind: 'labour',
    itemId: null,
    labourRateId: rate.id,
    description: rate.name,
    quantity: '1',
    unit: 'h',
    unitPrice: amountForInput(rate.hourlyPrice),
    vatCodeId: props.vatDefaults.labour,
    significantGood: false,
  })
  labourRateId.value = ''
}

function addCallOut() {
  lines.push({
    key: nextKey++,
    kind: 'call_out',
    itemId: null,
    labourRateId: null,
    description: t('ui.quotes.callOutDescription'),
    quantity: '1',
    unit: null,
    unitPrice: props.callOutFee ? amountForInput(props.callOutFee) : '',
    vatCodeId: props.vatDefaults.labour,
    significantGood: false,
  })
}

function addText() {
  lines.push({
    key: nextKey++,
    kind: 'text',
    itemId: null,
    labourRateId: null,
    description: '',
    quantity: '',
    unit: null,
    unitPrice: '',
    vatCodeId: null,
    significantGood: false,
  })
}

function move(index: number, offset: number) {
  const [line] = lines.splice(index, 1)
  lines.splice(index + offset, 0, line)
}

function save() {
  router.put(
    urlFor('quotes.update', { id: props.job.id }),
    {
      notes: notes.value,
      ...(validityDays.value !== '' && { validityDays: validityDays.value }),
      lines: lines.map((line) => ({
        kind: line.kind,
        ...(line.itemId && { itemId: line.itemId }),
        ...(line.labourRateId && { labourRateId: line.labourRateId }),
        description: line.description,
        ...(line.kind !== 'text' && {
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatCodeId: line.vatCodeId,
        }),
      })),
    },
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => (processing.value = false),
    }
  )
}

const lineError = (index: number, field: string) => errors.value[`lines.${index}.${field}`]

const confirmDecision = (message: string) => () => window.confirm(message)

// Importing lines as Charges (ADR 0012): every priced line chosen at first
const priced = computed(() => (props.quote?.lines ?? []).filter((line) => line.kind !== 'text'))
const chosen = ref<number[]>(priced.value.map((line) => line.id))
const target = ref<number | ''>('')
const technicianId = ref<number | ''>('')
const workerName = ref('')
const importing = ref(false)
const needsWorker = computed(() =>
  priced.value.some((line) => line.kind === 'labour' && chosen.value.includes(line.id))
)
// On a Visit, its Technicians; on the Job itself, any active Technician
const workers = computed(() => {
  const visit = props.openVisits.find((open) => open.id === target.value)
  return visit
    ? props.technicians.filter((user) => visit.technicianIds.includes(user.id))
    : props.technicians
})

function importLines() {
  router.post(
    urlFor('quotes.import_lines', { id: props.job.id }),
    {
      lineIds: chosen.value,
      ...(target.value !== '' && { visitId: target.value }),
      ...(needsWorker.value && technicianId.value !== '' && { technicianId: technicianId.value }),
      ...(needsWorker.value && technicianId.value === '' && { workerName: workerName.value }),
    },
    {
      preserveScroll: true,
      onStart: () => (importing.value = true),
      onFinish: () => (importing.value = false),
    }
  )
}
</script>

<template>
  <AppLayout>
    <Page
      :title="t('ui.quotes.title', { number: job.number })"
      :description="`${job.title} · ${job.customer}`"
    >
      <template #actions>
        <Link route="jobs.show" :params="{ id: job.id }" class="btn btn--ghost btn--sm">
          {{ t('ui.quotes.backToJob') }}
        </Link>
        <a
          v-if="quote"
          :href="urlFor('quotes.pdf', { id: job.id })"
          target="_blank"
          rel="noopener"
          class="btn btn--secondary btn--sm"
        >
          <FileText :size="15" /> {{ t('ui.quotes.pdf') }}
        </a>
      </template>

      <Section>
        <p v-if="quote" data-testid="quote-status">
          <span class="tag">{{ t(`ui.quotes.statuses.${quote.status}`) }}</span>
          <span v-if="quote.sentAt" class="field__hint">
            · {{ t('ui.quotes.sentOn', { date: formatDate(quote.sentAt) }) }}
          </span>
        </p>
        <p v-if="!editable" class="field__hint">{{ t('ui.quotes.notEditable') }}</p>

        <table class="table">
          <thead>
            <tr>
              <th v-if="importable" :style="{ width: '40px' }" />
              <th>{{ t('ui.quotes.description') }}</th>
              <th :style="{ width: '110px' }">{{ t('ui.quotes.quantity') }}</th>
              <th :style="{ width: '140px' }">{{ t('ui.quotes.unitPrice') }}</th>
              <th :style="{ width: '170px' }">{{ t('ui.quotes.vatCode') }}</th>
              <th :style="{ textAlign: 'right', width: '120px' }">{{ t('ui.quotes.amount') }}</th>
              <th v-if="editable" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in lines" :key="line.key">
              <td v-if="importable">
                <input
                  v-if="line.kind !== 'text'"
                  v-model="chosen"
                  type="checkbox"
                  :value="quote!.lines[index].id"
                  :aria-label="t('ui.quotes.importLineOf', { position: index + 1 })"
                />
              </td>
              <td>
                <span class="field__hint">{{ t(`ui.quotes.kinds.${line.kind}`) }}</span>
                <span
                  v-if="quote?.lines[index]?.imported"
                  class="tag"
                  data-testid="imported"
                  :style="{ marginLeft: '6px' }"
                >
                  {{ t('ui.quotes.imported', { count: quote.lines[index].imported }) }}
                </span>
                <input
                  v-model="line.description"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.quotes.descriptionOf', { position: index + 1 })"
                />
                <span v-if="lineError(index, 'description')" class="field__error">
                  {{ lineError(index, 'description') }}
                </span>
                <span
                  v-if="lineError(index, 'itemId') || lineError(index, 'labourRateId')"
                  class="field__error"
                >
                  {{ lineError(index, 'itemId') ?? lineError(index, 'labourRateId') }}
                </span>
              </td>
              <td>
                <template v-if="line.kind !== 'text'">
                  <input
                    v-model="line.quantity"
                    inputmode="decimal"
                    class="field__input"
                    :disabled="!editable"
                    :aria-label="t('ui.quotes.quantityOf', { position: index + 1 })"
                  />
                  <span class="field__hint">{{ line.unit }}</span>
                  <span v-if="lineError(index, 'quantity')" class="field__error">
                    {{ lineError(index, 'quantity') }}
                  </span>
                </template>
              </td>
              <td>
                <template v-if="line.kind !== 'text'">
                  <input
                    v-model="line.unitPrice"
                    inputmode="decimal"
                    class="field__input"
                    :disabled="!editable"
                    :aria-label="t('ui.quotes.unitPriceOf', { position: index + 1 })"
                  />
                  <span v-if="lineError(index, 'unitPrice')" class="field__error">
                    {{ lineError(index, 'unitPrice') }}
                  </span>
                </template>
              </td>
              <td>
                <template v-if="line.kind !== 'text'">
                  <select
                    v-model="line.vatCodeId"
                    class="field__input"
                    :disabled="!editable"
                    :aria-label="t('ui.quotes.vatCodeOf', { position: index + 1 })"
                  >
                    <option v-for="code in vatCodes" :key="code.id" :value="code.id">
                      {{ code.name }}
                    </option>
                  </select>
                  <span v-if="lineError(index, 'vatCodeId')" class="field__error">
                    {{ lineError(index, 'vatCodeId') }}
                  </span>
                  <span v-if="splitWarning(line)" class="field__hint" data-testid="split-warning">
                    {{ t('ui.invoices.significantGoodSplit') }}
                  </span>
                </template>
              </td>
              <td :style="{ textAlign: 'right' }">
                {{ totalOf(line) ? formatMoney(totalOf(line)!) : '' }}
              </td>
              <td v-if="editable" class="table__actions">
                <button
                  type="button"
                  class="iconbtn"
                  :disabled="index === 0"
                  :aria-label="t('ui.quotes.moveUp')"
                  @click="move(index, -1)"
                >
                  <ArrowUp :size="14" />
                </button>
                <button
                  type="button"
                  class="iconbtn"
                  :disabled="index === lines.length - 1"
                  :aria-label="t('ui.quotes.moveDown')"
                  @click="move(index, 1)"
                >
                  <ArrowDown :size="14" />
                </button>
                <button
                  type="button"
                  class="iconbtn"
                  :aria-label="t('ui.quotes.removeLine')"
                  @click="lines.splice(index, 1)"
                >
                  <Trash2 :size="14" />
                </button>
              </td>
            </tr>
            <tr v-if="lines.length === 0">
              <td :colspan="importable ? 7 : 6" :style="{ color: 'var(--subtle)' }">
                {{ t('ui.quotes.noLines') }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr v-for="row in totals.summary" :key="`${row.vatRate}-${row.natura}`">
              <td v-if="importable" />
              <td colspan="4" :style="{ textAlign: 'right' }">
                {{
                  t('ui.quotes.vatRow', { vat: vatLabel(row), taxable: formatMoney(row.taxable) })
                }}
              </td>
              <td :style="{ textAlign: 'right' }">{{ formatMoney(row.vat) }}</td>
              <td v-if="editable" />
            </tr>
            <tr>
              <td v-if="importable" />
              <td colspan="4" :style="{ textAlign: 'right' }">{{ t('ui.quotes.taxable') }}</td>
              <td :style="{ textAlign: 'right' }">{{ formatMoney(totals.taxable) }}</td>
              <td v-if="editable" />
            </tr>
            <tr>
              <td v-if="importable" />
              <td colspan="4" :style="{ textAlign: 'right' }">
                <strong>{{ t('ui.quotes.total') }}</strong>
              </td>
              <td :style="{ textAlign: 'right' }">
                <strong>{{ formatMoney(totals.total) }}</strong>
              </td>
              <td v-if="editable" />
            </tr>
          </tfoot>
        </table>
      </Section>

      <Section
        v-if="importable"
        :title="t('ui.quotes.importTitle')"
        :description="t('ui.quotes.importHint')"
      >
        <div class="field">
          <label class="field__label" for="import-target">{{ t('ui.quotes.importOnto') }}</label>
          <select id="import-target" v-model="target" class="field__input">
            <option value="">{{ t('ui.quotes.importOntoJob') }}</option>
            <option v-for="visit in openVisits" :key="visit.id" :value="visit.id">
              {{ t('ui.charges.visit', { date: formatDate(visit.startsAt) }) }}
              {{ visit.startsAt.slice(11, 16) }}
            </option>
          </select>
          <span class="field__hint">{{ t('ui.quotes.importOntoHint') }}</span>
          <span v-if="errors.visitId" class="field__error">{{ errors.visitId }}</span>
        </div>
        <template v-if="needsWorker">
          <div class="field">
            <label class="field__label" for="import-worker">{{ t('ui.charges.worker') }}</label>
            <select id="import-worker" v-model="technicianId" class="field__input">
              <option value="">{{ t('ui.charges.someoneElse') }}</option>
              <option v-for="user in workers" :key="user.id" :value="user.id">
                {{ user.name }}
              </option>
            </select>
            <span class="field__hint">{{ t('ui.quotes.importWorkerHint') }}</span>
          </div>
          <div v-if="technicianId === ''" class="field">
            <label class="field__label" for="import-worker-name">{{
              t('ui.charges.workerName')
            }}</label>
            <input id="import-worker-name" v-model="workerName" class="field__input" />
            <span v-if="errors.workerName" class="field__error">{{ errors.workerName }}</span>
          </div>
        </template>
        <span v-if="errors.lineIds" class="field__error">{{ errors.lineIds }}</span>
        <div>
          <button
            type="button"
            class="btn btn--primary btn--sm"
            :disabled="importing || !chosen.length"
            @click="importLines"
          >
            {{ t('ui.quotes.import', { count: chosen.length }) }}
          </button>
        </div>
      </Section>

      <Section v-if="editable" :title="t('ui.quotes.addTitle')">
        <ItemPicker :label="t('ui.quotes.addItem')" @select="addItem" />
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }">
          <div class="field">
            <label class="field__label" for="labour-rate">{{ t('ui.quotes.addLabour') }}</label>
            <select id="labour-rate" v-model="labourRateId" class="field__input">
              <option value="" disabled>{{ t('ui.quotes.chooseRate') }}</option>
              <option v-for="rate in labourRates" :key="rate.id" :value="rate.id">
                {{ rate.name }} · {{ formatUnitPrice(rate.hourlyPrice) }}/h
              </option>
            </select>
          </div>
          <button
            type="button"
            class="btn btn--secondary btn--sm"
            :disabled="!labourRateId"
            @click="addLabour"
          >
            {{ t('ui.quotes.addLabourButton') }}
          </button>
          <button type="button" class="btn btn--secondary btn--sm" @click="addCallOut">
            {{ t('ui.quotes.addCallOut') }}
          </button>
          <button type="button" class="btn btn--secondary btn--sm" @click="addText">
            {{ t('ui.quotes.addText') }}
          </button>
        </div>
      </Section>

      <Section :title="t('ui.quotes.notes')">
        <textarea
          v-model="notes"
          class="field__input"
          rows="3"
          :disabled="!editable"
          :aria-label="t('ui.quotes.notes')"
        />
        <span v-if="errors.notes" class="field__error">{{ errors.notes }}</span>
        <div class="field">
          <label class="field__label" for="validity-days">{{ t('ui.quotes.validityDays') }}</label>
          <input
            id="validity-days"
            v-model="validityDays"
            type="number"
            min="1"
            max="365"
            class="field__input"
            :disabled="!editable"
            :style="{ maxWidth: '120px' }"
          />
          <span class="field__hint">
            {{
              quote?.issuedOn
                ? t('ui.quotes.issuedOn', { date: formatDate(quote.issuedOn) })
                : t('ui.quotes.validityHint')
            }}
          </span>
          <span v-if="errors.validityDays" class="field__error">{{ errors.validityDays }}</span>
        </div>
      </Section>

      <Section v-if="editable">
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
          <button type="button" class="btn btn--primary" :disabled="processing" @click="save">
            {{ t('ui.quotes.save') }}
          </button>
          <span v-if="dirty" class="field__hint">{{ t('ui.quotes.unsaved') }}</span>
        </div>
        <span v-if="errors.lines" class="field__error">{{ errors.lines }}</span>
      </Section>

      <Section v-if="quote && decidable" :title="t('ui.quotes.decisionTitle')">
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
          <Form
            v-if="sendable"
            route="quotes.send"
            :params="{ id: job.id }"
            :on-before="confirmDecision(t('ui.quotes.sendConfirm'))"
          >
            <button type="submit" class="btn btn--secondary btn--sm" :disabled="dirty">
              {{ t('ui.quotes.send') }}
            </button>
          </Form>
          <Form
            route="quotes.accept"
            :params="{ id: job.id }"
            :on-before="
              confirmDecision(
                t('ui.quotes.acceptConfirm', { total: formatMoney(quote.totals.total) })
              )
            "
          >
            <button type="submit" class="btn btn--primary btn--sm" :disabled="dirty">
              {{ t('ui.quotes.accept') }}
            </button>
          </Form>
          <Form
            route="quotes.decline"
            :params="{ id: job.id }"
            :on-before="confirmDecision(t('ui.quotes.declineConfirm', { number: job.number }))"
          >
            <button type="submit" class="btn btn--ghost btn--sm" :disabled="dirty">
              {{ t('ui.quotes.decline') }}
            </button>
          </Form>
        </div>
        <p v-if="dirty" class="field__hint">{{ t('ui.quotes.saveBeforeDeciding') }}</p>
      </Section>
    </Page>
  </AppLayout>
</template>
