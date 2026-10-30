<script setup lang="ts">
/**
 * A Quote, an Entity screen on the new UI (docs/ui.md): one screen for
 * writing it and for reading it once sent. Its header actions come from
 * the server; Save is the primary while it is a draft. The lines are the
 * main work and stay editable while it is a draft, their totals worked out
 * as you type (shared/ rules, run again by the server on save); an Item on
 * a line opens its preview. An accepted Quote's lines are imported as
 * Charges under them; adding lines, the notes and validity come last.
 */
import { QUOTE_VALIDITY_DAYS, type QuoteStatus } from '@shared/quotes'
import type { ScreenAction } from '@shared/screen_actions'
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { ArrowDown, ArrowUp, CircleAlert, Trash2 } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import ItemPreview from '~/components/item_preview.vue'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import FormField from '~/components/screen/form_field.vue'
import RowErrors from '~/components/screen/row_errors.vue'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import { LINK, QUOTE_TONES } from '~/components/screen/screen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { NativeSelect } from '~/components/ui/native-select'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import { formatMoney, formatUnitPrice, t } from '~/i18n'
import { amountForInput, lineTotal, parseAmount, parseQuantity } from '@shared/money'
import { lineKindOf, needsSignificantGoodSplit, vatLabel, type LineKind } from '@shared/vat'
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
  // The header's actions, for the user's role and the Quote's status
  actions: ScreenAction[]
  job: {
    id: number
    number: string
    title: string
    status: string
    customer: string
    customerId: number
  }
  // Null while writing a new Quote, saved as a draft
  quote: {
    id: number
    number: string
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
  // An Item on a line opens its preview, for those who may open the Item
  previewItems: boolean
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
// '' while empty; a number input's v-model gives numbers otherwise
const validityDays = ref<number | string>(props.quote?.validityDays ?? '')

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
const labourRateId = ref('')

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
  const rate = props.labourRates.find((r) => String(r.id) === labourRateId.value)
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
  if (processing.value) return
  const body = {
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
  }
  const options = {
    preserveScroll: true,
    onStart: () => (processing.value = true),
    onFinish: () => (processing.value = false),
  }
  // A new Quote is created on its Job by the first save
  if (props.quote) router.put(urlFor('quotes.update', { id: props.quote.id }), body, options)
  else router.post(urlFor('quotes.store', { id: props.job.id }), body, options)
}

// The header: unsaved edits hold back sending and the Customer's answer,
// which would freeze what the server has, not what is on screen
const DECISIONS = ['send', 'accept', 'decline']
const screenActions = computed(() =>
  props.actions.map((action) =>
    dirty.value && DECISIONS.includes(action.name)
      ? { ...action, disabledReason: t('ui.quotes.saveBeforeDeciding') }
      : action
  )
)
function runAction(name: string) {
  // A file, not a page: opened beside the screen
  if (name === 'pdf' && props.quote) {
    window.open(urlFor('quotes.pdf', { id: props.quote.id }), '_blank', 'noopener')
  }
}

const facts = computed(() =>
  [
    props.job.title,
    props.quote?.sentAt && t('ui.quotes.sentOn', { date: formatDate(props.quote.sentAt) }),
  ]
    .filter(Boolean)
    .join(' · ')
)
const keyFacts = computed<KeyFact[]>(() => [
  {
    label: t('ui.quotes.job'),
    value: props.job.number,
    href: urlFor('jobs.show', { id: props.job.id }),
  },
  {
    label: t('ui.quotes.customer'),
    value: props.job.customer,
    href: urlFor('customers.show', { id: props.job.customerId }),
  },
  {
    label: t('ui.quotes.total'),
    value: formatMoney(totals.value.total),
    amount: true,
    hint: t('ui.quotes.totalsTaxable', { amount: formatMoney(totals.value.taxable) }),
  },
  {
    label: t('ui.quotes.dated'),
    value: props.quote?.issuedOn ? formatDate(props.quote.issuedOn) : '—',
    hint: props.quote?.validityDays
      ? t('ui.quotes.validFor', { count: props.quote.validityDays })
      : undefined,
  },
])

// A line's errors show after its inputs, each naming its field (#226)
const LINE_FIELDS = computed(() => ({
  description: t('ui.quotes.description'),
  itemId: t('ui.quotes.kinds.item'),
  labourRateId: t('ui.quotes.kinds.labour'),
  quantity: t('ui.quotes.quantity'),
  unitPrice: t('ui.quotes.unitPrice'),
  vatCodeId: t('ui.quotes.vatCode'),
}))
const lineErrors = (index: number) =>
  Object.fromEntries(
    Object.keys(LINE_FIELDS.value).flatMap((field) => {
      const message = errors.value[`lines.${index}.${field}`]
      return message ? [[field, message]] : []
    })
  ) as Record<string, string>
const invalid = (index: number, field: string) =>
  errors.value[`lines.${index}.${field}`] ? 'true' : undefined

// Importing lines as Charges (ADR 0012): every priced line chosen at first
const priced = computed(() => (props.quote?.lines ?? []).filter((line) => line.kind !== 'text'))
const chosen = ref<number[]>(priced.value.map((line) => line.id))
const target = ref('')
const technicianId = ref('')
const workerName = ref('')
const importing = ref(false)
const needsWorker = computed(() =>
  priced.value.some((line) => line.kind === 'labour' && chosen.value.includes(line.id))
)
// On a Visit, its Technicians; on the Job itself, any active Technician
const workers = computed(() => {
  const visit = props.openVisits.find((open) => String(open.id) === target.value)
  return visit
    ? props.technicians.filter((user) => visit.technicianIds.includes(user.id))
    : props.technicians
})

function importLines() {
  router.post(
    urlFor('quotes.import_lines', { id: props.quote!.id }),
    {
      lineIds: chosen.value,
      ...(target.value !== '' && { visitId: Number(target.value) }),
      ...(needsWorker.value &&
        technicianId.value !== '' && { technicianId: Number(technicianId.value) }),
      ...(needsWorker.value && technicianId.value === '' && { workerName: workerName.value }),
    },
    {
      preserveScroll: true,
      onStart: () => (importing.value = true),
      onFinish: () => (importing.value = false),
    }
  )
}

// The Item a line names, previewed over the Quote (docs/ui.md "Hierarchy and references")
const previewedItem = ref<number | null>(null)
const PREVIEW_LINK = 'text-left underline decoration-muted-foreground decoration-dotted'

/**
 * A line: on the phone a card (description, then quantity and price side
 * by side, VAT, amount and the line's buttons, each field named above
 * it); from 768px one row, its fields under the column heads (`RowField`,
 * `RowHeads`, #226), each head taking its field's width.
 */
const ROW =
  'grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border px-3.5 py-3 md:flex md:flex-wrap md:items-start md:gap-x-2 md:px-4'
const DESCRIPTION = 'md:min-w-0 md:flex-1'
const QUANTITY = 'md:w-28'
const PRICE = 'md:w-32'
const VAT = 'md:w-40'
const AMOUNT = 'md:w-28 md:text-right'
const LINE_BUTTONS = 'md:w-[7.5rem]'
// Fields sit level with the description's input, under the line's kind
const UNDER_KIND = 'md:pt-[30px]'
const heads = computed(() => [
  { label: t('ui.quotes.description'), class: DESCRIPTION },
  { label: t('ui.quotes.quantity'), class: QUANTITY },
  { label: t('ui.quotes.unitPrice'), class: PRICE },
  { label: t('ui.quotes.vatCode'), class: VAT },
  { label: t('ui.quotes.amount'), class: AMOUNT },
  ...(props.editable ? [{ label: '', class: LINE_BUTTONS }] : []),
])
const FIELD = 'h-11 md:h-9'
const BUTTON = 'h-11 md:h-9'
const ERROR = 'm-0 flex items-start gap-1.5 text-sm text-destructive'
const HINT = 'm-0 text-[13px] text-muted-foreground'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="quote ? t('ui.quotes.title', { number: quote.number }) : t('ui.quotes.new')"
      :crumbs="[
        { label: t('ui.jobs.title'), href: urlFor('jobs.index') },
        { label: job.number, href: urlFor('jobs.show', { id: job.id }) },
      ]"
      :current="quote?.number ?? t('ui.quotes.new')"
      :title="quote ? t('ui.quotes.title', { number: quote.number }) : t('ui.quotes.new')"
      :facts="facts"
      :actions="screenActions"
      :key-facts="keyFacts"
      :busy="processing"
      @dialog="runAction"
    >
      <template #tags>
        <StatusTag v-if="quote" :tone="QUOTE_TONES[quote.status]" data-testid="quote-status">
          {{ t(`ui.quotes.statuses.${quote.status}`) }}
        </StatusTag>
      </template>

      <template #main>
        <ScreenSection :title="t('ui.quotes.lines')" flush>
          <template #actions>
            <span v-if="dirty" role="status" class="text-[13px] text-muted-foreground">
              {{ t('ui.quotes.unsaved') }}
            </span>
          </template>
          <p v-if="!editable" :class="cn(HINT, 'px-3.5 pb-2 md:px-4')">
            {{ t('ui.quotes.notEditable') }}
          </p>

          <RowHeads :heads="heads" />

          <ol v-if="lines.length" class="m-0 list-none p-0" data-testid="quote-lines">
            <li
              v-for="(line, index) in lines"
              :key="line.key"
              :class="ROW"
              :aria-label="t('ui.quotes.lineOf', { position: index + 1 })"
            >
              <!-- What the line is, then its description -->
              <div :class="cn('col-span-2 flex min-w-0 flex-col gap-1.5', DESCRIPTION)">
                <div class="flex min-h-6 flex-wrap items-center gap-2 text-[13px]">
                  <label
                    v-if="importable && line.kind !== 'text'"
                    class="flex min-h-11 min-w-11 items-center md:min-h-0 md:min-w-0"
                  >
                    <input
                      v-model="chosen"
                      type="checkbox"
                      class="size-4"
                      :value="quote!.lines[index].id"
                      :aria-label="t('ui.quotes.importLineOf', { position: index + 1 })"
                    />
                  </label>
                  <button
                    v-if="line.kind === 'item' && line.itemId !== null && previewItems"
                    type="button"
                    aria-haspopup="dialog"
                    :aria-label="t('ui.quotes.previewItemOf', { position: index + 1 })"
                    :class="cn(LINK, PREVIEW_LINK, 'flex min-h-11 items-center md:min-h-0')"
                    @click="previewedItem = line.itemId"
                  >
                    {{ t(`ui.quotes.kinds.${line.kind}`) }}
                  </button>
                  <span v-else class="text-muted-foreground">
                    {{ t(`ui.quotes.kinds.${line.kind}`) }}
                  </span>
                  <StatusTag
                    v-if="quote?.lines[index]?.imported"
                    tone="green"
                    data-testid="imported"
                  >
                    {{ t('ui.quotes.imported', { count: quote.lines[index].imported }) }}
                  </StatusTag>
                </div>
                <Input
                  v-model="line.description"
                  form="quote-form"
                  :class="FIELD"
                  :disabled="!editable"
                  :aria-label="t('ui.quotes.descriptionOf', { position: index + 1 })"
                  :aria-invalid="invalid(index, 'description')"
                />
              </div>

              <template v-if="line.kind !== 'text'">
                <RowField :label="t('ui.quotes.quantity')" :class="cn(QUANTITY, UNDER_KIND)">
                  <div class="flex items-center gap-1.5">
                    <Input
                      v-model="line.quantity"
                      form="quote-form"
                      inputmode="decimal"
                      :class="FIELD"
                      :disabled="!editable"
                      :aria-label="t('ui.quotes.quantityOf', { position: index + 1 })"
                      :aria-invalid="invalid(index, 'quantity')"
                    />
                    <span v-if="line.unit" class="text-[13px] text-muted-foreground">
                      {{ line.unit }}
                    </span>
                  </div>
                </RowField>
                <RowField :label="t('ui.quotes.unitPrice')" :class="cn(PRICE, UNDER_KIND)">
                  <Input
                    v-model="line.unitPrice"
                    form="quote-form"
                    inputmode="decimal"
                    :class="FIELD"
                    :disabled="!editable"
                    :aria-label="t('ui.quotes.unitPriceOf', { position: index + 1 })"
                    :aria-invalid="invalid(index, 'unitPrice')"
                  />
                </RowField>
                <RowField
                  :label="t('ui.quotes.vatCode')"
                  :class="cn('col-span-2', VAT, UNDER_KIND)"
                >
                  <NativeSelect
                    :model-value="line.vatCodeId === null ? '' : String(line.vatCodeId)"
                    :disabled="!editable"
                    :aria-label="t('ui.quotes.vatCodeOf', { position: index + 1 })"
                    :aria-invalid="invalid(index, 'vatCodeId')"
                    @update:model-value="(value) => (line.vatCodeId = value ? Number(value) : null)"
                  >
                    <option v-for="code in vatCodes" :key="code.id" :value="String(code.id)">
                      {{ code.name }}
                    </option>
                  </NativeSelect>
                  <p v-if="splitWarning(line)" :class="HINT" data-testid="split-warning">
                    {{ t('ui.invoices.significantGoodSplit') }}
                  </p>
                </RowField>
                <RowField
                  :label="t('ui.quotes.amount')"
                  :class="cn(AMOUNT, UNDER_KIND, 'md:items-end')"
                >
                  <span
                    class="text-[15px] font-semibold whitespace-nowrap md:inline-flex md:h-9 md:items-center md:text-sm"
                  >
                    {{ totalOf(line) ? formatMoney(totalOf(line)!) : '' }}
                  </span>
                </RowField>
              </template>
              <!-- A text line has no figures: its row keeps the columns' widths -->
              <template v-else>
                <span :class="cn('hidden md:block', QUANTITY)" />
                <span :class="cn('hidden md:block', PRICE)" />
                <span :class="cn('hidden md:block', VAT)" />
                <span :class="cn('hidden md:block', AMOUNT)" />
              </template>

              <div
                v-if="editable"
                :class="
                  cn(
                    'flex items-center justify-end gap-1',
                    LINE_BUTTONS,
                    UNDER_KIND,
                    line.kind === 'text' && 'col-span-2'
                  )
                "
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-touch"
                  class="md:size-9"
                  :disabled="index === 0"
                  :aria-label="t('ui.quotes.moveUp')"
                  @click="move(index, -1)"
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-touch"
                  class="md:size-9"
                  :disabled="index === lines.length - 1"
                  :aria-label="t('ui.quotes.moveDown')"
                  @click="move(index, 1)"
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-touch"
                  class="md:size-9"
                  :aria-label="t('ui.quotes.removeLine')"
                  @click="lines.splice(index, 1)"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>

              <div
                v-if="Object.keys(lineErrors(index)).length"
                class="col-span-full flex flex-col gap-1 md:basis-full"
              >
                <RowErrors :errors="lineErrors(index)" :fields="LINE_FIELDS" />
              </div>
            </li>
          </ol>
          <p
            v-else
            class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4"
          >
            {{ t('ui.quotes.noLines') }}
          </p>
          <p v-if="errors.lines" :class="cn(ERROR, 'border-t border-border px-3.5 py-3 md:px-4')">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ errors.lines }}
          </p>

          <!-- The totals, as you type -->
          <dl
            class="m-0 flex flex-col gap-1 border-t border-border px-3.5 py-3 text-sm tabular-nums md:px-4"
            data-testid="quote-totals"
          >
            <div
              v-for="row in totals.summary"
              :key="`${row.vatRate}-${row.natura}`"
              class="flex justify-end gap-4 text-muted-foreground"
            >
              <dt>
                {{
                  t('ui.quotes.vatRow', { vat: vatLabel(row), taxable: formatMoney(row.taxable) })
                }}
              </dt>
              <dd class="m-0 min-w-24 text-right">{{ formatMoney(row.vat) }}</dd>
            </div>
            <div class="flex justify-end gap-4">
              <dt>{{ t('ui.quotes.taxable') }}</dt>
              <dd class="m-0 min-w-24 text-right">{{ formatMoney(totals.taxable) }}</dd>
            </div>
            <div class="flex justify-end gap-4 text-[15px] font-bold">
              <dt>{{ t('ui.quotes.total') }}</dt>
              <dd class="m-0 min-w-24 text-right">{{ formatMoney(totals.total) }}</dd>
            </div>
          </dl>
        </ScreenSection>
      </template>

      <ScreenSection v-if="importable" :title="t('ui.quotes.importTitle')">
        <p :class="HINT">{{ t('ui.quotes.importHint') }}</p>
        <div class="grid gap-4 md:grid-cols-2">
          <FormField
            id="import-target"
            v-slot="field"
            :label="t('ui.quotes.importOnto')"
            :hint="t('ui.quotes.importOntoHint')"
            :error="errors.visitId"
          >
            <NativeSelect
              :id="field.id"
              v-model="target"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            >
              <option value="">{{ t('ui.quotes.importOntoJob') }}</option>
              <option v-for="visit in openVisits" :key="visit.id" :value="String(visit.id)">
                {{ t('ui.charges.visit', { date: formatDate(visit.startsAt) }) }}
                {{ visit.startsAt.slice(11, 16) }}
              </option>
            </NativeSelect>
          </FormField>
          <template v-if="needsWorker">
            <FormField
              id="import-worker"
              v-slot="field"
              :label="t('ui.charges.worker')"
              :hint="t('ui.quotes.importWorkerHint')"
            >
              <NativeSelect
                :id="field.id"
                v-model="technicianId"
                :aria-describedby="field.describedBy"
              >
                <option value="">{{ t('ui.charges.someoneElse') }}</option>
                <option v-for="user in workers" :key="user.id" :value="String(user.id)">
                  {{ user.name }}
                </option>
              </NativeSelect>
            </FormField>
            <FormField
              v-if="technicianId === ''"
              id="import-worker-name"
              v-slot="field"
              :label="t('ui.charges.workerName')"
              :error="errors.workerName"
            >
              <Input
                :id="field.id"
                v-model="workerName"
                :class="FIELD"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </template>
        </div>
        <p v-if="errors.lineIds" :class="ERROR">
          <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
          {{ errors.lineIds }}
        </p>
        <Button
          type="button"
          :class="cn(BUTTON, 'self-start')"
          :disabled="importing || !chosen.length"
          @click="importLines"
        >
          {{ t('ui.quotes.import', { count: chosen.length }) }}
        </Button>
      </ScreenSection>

      <!-- Adding lines and the terms, under the lines -->
      <div class="grid items-start gap-3 md:grid-cols-2 md:gap-5">
        <ScreenSection v-if="editable" :title="t('ui.quotes.addTitle')">
          <ItemPicker :label="t('ui.quotes.addItem')" @select="addItem" />
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <FormField id="labour-rate" v-slot="field" :label="t('ui.quotes.addLabour')">
                <NativeSelect :id="field.id" v-model="labourRateId">
                  <option value="" disabled>{{ t('ui.quotes.chooseRate') }}</option>
                  <option v-for="rate in labourRates" :key="rate.id" :value="String(rate.id)">
                    {{ rate.name }} · {{ formatUnitPrice(rate.hourlyPrice) }}/h
                  </option>
                </NativeSelect>
              </FormField>
            </div>
            <Button
              type="button"
              variant="outline"
              :class="BUTTON"
              :disabled="!labourRateId"
              @click="addLabour"
            >
              {{ t('ui.quotes.addLabourButton') }}
            </Button>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button type="button" variant="outline" :class="BUTTON" @click="addCallOut">
              {{ t('ui.quotes.addCallOut') }}
            </Button>
            <Button type="button" variant="outline" :class="BUTTON" @click="addText">
              {{ t('ui.quotes.addText') }}
            </Button>
          </div>
        </ScreenSection>

        <ScreenSection v-if="editable" :title="t('ui.quotes.terms')">
          <FormField
            id="quote-notes"
            v-slot="field"
            :label="t('ui.quotes.notes')"
            :error="errors.notes"
          >
            <Textarea
              :id="field.id"
              v-model="notes"
              rows="3"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="validity-days"
            v-slot="field"
            :label="t('ui.quotes.validityDays')"
            :hint="
              quote?.issuedOn
                ? t('ui.quotes.issuedOn', { date: formatDate(quote.issuedOn) })
                : t('ui.quotes.validityHint')
            "
            :error="errors.validityDays"
          >
            <Input
              :id="field.id"
              v-model="validityDays"
              form="quote-form"
              type="number"
              :min="QUOTE_VALIDITY_DAYS.min"
              :max="QUOTE_VALIDITY_DAYS.max"
              :class="cn(FIELD, 'max-w-32')"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
        </ScreenSection>
        <!-- Frozen: what went out, as text -->
        <ScreenSection
          v-else-if="quote && (quote.notes || quote.validityDays)"
          :title="t('ui.quotes.terms')"
        >
          <dl class="m-0 flex flex-col gap-3 text-sm">
            <div v-if="quote.notes" class="flex flex-col gap-1">
              <dt class="font-medium">{{ t('ui.quotes.notes') }}</dt>
              <dd class="m-0 whitespace-pre-line">{{ quote.notes }}</dd>
            </div>
            <div v-if="quote.validityDays" class="flex flex-col gap-1">
              <dt class="font-medium">{{ t('ui.quotes.validityDays') }}</dt>
              <dd class="m-0">{{ quote.validityDays }}</dd>
            </div>
          </dl>
        </ScreenSection>
      </div>
    </EntityScreen>

    <!-- What Save submits (the header's button names it). The lines' and the
         validity's inputs belong to it (`form`), so Enter in them saves; the
         body is sent from the editor's state. The Item search, the labour
         rate and the import fields stay out, so Enter there never saves -->
    <form id="quote-form" class="hidden" @submit.prevent="save" />

    <ItemPreview v-model:item-id="previewedItem" />
  </AppLayout>
</template>
