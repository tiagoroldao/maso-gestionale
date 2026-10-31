<script setup lang="ts">
/**
 * Fills a Document Template's fields for a Customer: a value per field,
 * with Sites, Installed Equipment and Jobs offered as the server scopes
 * them, "load from Job" for Item and table fields, and a work report's
 * period and choices (#180), which the server fills from the Job.
 * `input()` gives what the server checks and prints
 * (services/template_data.ts). It can start with a Customer and values (a
 * replacement's original).
 *
 * Its fields stack in one column, each named above its control, with its
 * error under it (docs/ui.md "Look"); a chosen Customer, Site or Item shows
 * as text with "Cambia" beside it, and a table field's rows are edited in
 * place, stacked on the phone (docs/ui.md "Settings"). The page puts it in
 * a section of its screen.
 */
import { computed, reactive, ref, useId, watch } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import CustomerPicker, { type PickedCustomer } from '~/components/customer_picker.vue'
import ItemPicker from '~/components/item_picker.vue'
import SitePicker from '~/components/site_picker.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import { Textarea } from '~/components/ui/textarea'
import FormField from '~/components/screen/form_field.vue'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import { EDIT_ROW, EMPTY, TOUCH } from '~/components/screen/screen'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import type { FieldType, TemplateField, TemplatePrefill } from '@shared/document_templates'
import type { WorkReportOptions } from '@shared/work_report'

type Choice = { id: number; label: string }
type ItemUsed = { id: number; code: string; description: string; unit: string; quantity: string }
// A work report's options as the inputs hold them: an open end is ''
type ReportInput = {
  from: string
  to: string
  prices: boolean
  notes: boolean
  jobCharges: boolean
}

const props = defineProps<{
  fields: TemplateField[]
  errors: Record<string, string>
  initialCustomer?: PickedCustomer | null
  prefill?: Record<string, TemplatePrefill>
}>()

const customer = ref<PickedCustomer | null>(null)
// One store per kind of value, by field key; without a prototype, so a
// field keyed `constructor` starts empty
const store = <T,>() => reactive<Record<string, T>>(Object.create(null))
const texts = store<string>()
const checks = store<boolean>()
const chosen = store<Choice | null>()
const lists = store<Choice[]>()
const rows = store<string[][]>()
const reports = store<ReportInput>()
for (const field of props.fields) {
  if (field.type === 'work_report') {
    reports[field.key] = { from: '', to: '', prices: false, notes: false, jobCharges: true }
  }
}

const siteField = computed(() => props.fields.find((field) => field.type === 'site'))
const jobField = computed(() => props.fields.find((field) => field.type === 'job'))
const loadsFromJob = computed(() =>
  props.fields.some((field) => ['item', 'items', 'table'].includes(field.type))
)
const site = computed(() => (siteField.value ? chosen[siteField.value.key] : null))
const job = computed(() => (jobField.value ? chosen[jobField.value.key] : null))

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} failed with ${response.status}`)
  return (await response.json()) as T
}

// Installed Equipment at the chosen Site, Jobs of the chosen Customer
const options = reactive({ equipment: [] as Choice[], job: [] as Choice[] })
const failed = reactive({ equipment: false, job: false })

watch(site, async (chosenSite) => {
  for (const field of props.fields) if (field.type === 'equipment') chosen[field.key] = null
  options.equipment = []
  failed.equipment = false
  if (!chosenSite) return
  try {
    const answer = await getJson<{ equipment: { id: number; description: string }[] }>(
      urlFor('template_choices.equipment', { id: chosenSite.id })
    )
    options.equipment = answer.equipment.map((unit) => ({ id: unit.id, label: unit.description }))
    for (const [key, choice] of Object.entries(pendingEquipment)) {
      chosen[key] = choice
      delete pendingEquipment[key]
    }
  } catch {
    failed.equipment = true
  }
})

// Prefilled equipment, chosen once the Site's equipment has loaded
const pendingEquipment: Record<string, Choice> = {}

async function chooseCustomer(picked: PickedCustomer) {
  customer.value = picked
  // Sites, Equipment and Jobs depend on the Customer
  for (const field of props.fields) {
    if (['site', 'equipment', 'job'].includes(field.type)) chosen[field.key] = null
  }
  loaded.value = null
  await loadJobs(picked)
}

async function loadJobs(picked: PickedCustomer) {
  options.job = []
  failed.job = false
  if (!jobField.value) return
  try {
    const answer = await getJson<{ jobs: { id: number; number: string; title: string }[] }>(
      urlFor('template_choices.jobs', { id: picked.id })
    )
    options.job = answer.jobs.map((one) => ({ id: one.id, label: `${one.number} – ${one.title}` }))
  } catch {
    failed.job = true
  }
}

function choose(field: TemplateField, id: string) {
  const list = field.type === 'job' ? options.job : options.equipment
  chosen[field.key] = list.find((option) => option.id === Number(id)) ?? null
}

const loaded = ref<number | null>(null)
const loadFailed = ref(false)

/**
 * Fills Item fields with the first Item used on the Job, Items fields
 * with all of them, and tables with a row per Item.
 */
async function loadFromJob() {
  if (!job.value) return
  loadFailed.value = false
  try {
    const { items } = await getJson<{ items: ItemUsed[] }>(
      urlFor('template_choices.items_used', { id: job.value.id })
    )
    const choices = items.map((item) => ({ id: item.id, label: item.description }))
    for (const field of props.fields) {
      if (field.type === 'item') chosen[field.key] = choices[0] ?? null
      if (field.type === 'items') lists[field.key] = choices
      if (field.type === 'table') {
        rows[field.key] = items.map((item) =>
          (field.columns ?? []).map((column) => (column.from ? item[column.from] : ''))
        )
      }
    }
    loaded.value = items.length
  } catch {
    loadFailed.value = true
  }
}

function addRow(field: TemplateField) {
  rows[field.key] = [...(rows[field.key] ?? []), (field.columns ?? []).map(() => '')]
}

function value(field: TemplateField): unknown {
  switch (field.type) {
    case 'boolean':
      return checks[field.key] ?? false
    case 'site':
    case 'equipment':
    case 'job':
    case 'item':
      return chosen[field.key]?.id ?? null
    case 'items':
      return (lists[field.key] ?? []).map((item) => item.id)
    case 'table':
      return rows[field.key] ?? []
    case 'work_report':
      return reports[field.key]
    default:
      return texts[field.key] ?? ''
  }
}

function input() {
  return {
    customerId: customer.value?.id ?? null,
    values: Object.fromEntries(props.fields.map((field) => [field.key, value(field)])),
  }
}

/**
 * Starts from the initial Customer and values: each value goes in the
 * store its field's kind reads.
 */
function start() {
  if (!props.initialCustomer) return
  customer.value = props.initialCustomer
  void loadJobs(props.initialCustomer)
  for (const field of props.fields) {
    if (!props.prefill || !Object.hasOwn(props.prefill, field.key)) continue
    const initial = props.prefill[field.key]
    if (field.type === 'equipment') pendingEquipment[field.key] = initial as Choice
    else if (['site', 'job', 'item'].includes(field.type)) chosen[field.key] = initial as Choice
    else if (field.type === 'items') lists[field.key] = initial as Choice[]
    else if (field.type === 'table') rows[field.key] = initial as string[][]
    else if (field.type === 'work_report') {
      const report = initial as WorkReportOptions
      reports[field.key] = { ...report, from: report.from ?? '', to: report.to ?? '' }
    } else if (field.type === 'boolean') checks[field.key] = initial as boolean
    else texts[field.key] = initial as string
  }
}
start()

// The Customer chosen, for the page's question before issuing
defineExpose({ input, customer })

/** Ids for the fields' controls, unique on the page */
const uid = useId()
const idOf = (key: string, part = '') => `${uid}-${key}${part}`

/** A field's error, else a list that didn't load */
function selectError(field: TemplateField) {
  if (props.errors[field.key]) return props.errors[field.key]
  return failed[field.type as 'equipment' | 'job'] ? t('ui.documentTemplates.fill.loadFailed') : ''
}

/** Why an Equipment or Job list is empty, when it is */
function selectHint(field: TemplateField) {
  if (field.type === 'equipment' && !site.value) return t('ui.documentTemplates.fill.noSiteYet')
  if (options[field.type as 'equipment' | 'job'].length > 0) return ''
  return t(
    field.type === 'job'
      ? 'ui.documentTemplates.fill.noJobs'
      : 'ui.documentTemplates.fill.noEquipment'
  )
}

/** A label above a control that isn't a single input: a picker's choice, a table, a group */
const NAME = 'm-0 text-sm leading-none font-medium'
/** A choice made, shown as text with "Cambia" beside it */
const CHOSEN =
  'm-0 flex min-h-11 items-center justify-between gap-2 rounded-sm border border-border bg-background py-1 pr-1 pl-3 text-sm md:min-h-9'
const ERROR = 'm-0 flex items-start gap-1.5 text-sm text-destructive'
const HINT = 'm-0 text-[13px] text-muted-foreground'
const CHECK = 'flex min-h-11 items-center gap-2 text-sm md:min-h-9'
/** A table column's width on desktop, under its head */
const CELL = 'md:w-44'
/** The fields in a `FormField`, which shows their error under the control */
const OWN_ERROR = new Set<FieldType>([
  'text',
  'long_text',
  'number',
  'date',
  'choice',
  'equipment',
  'job',
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <dl v-if="customer" class="m-0 flex flex-col gap-1.5" data-field="customer">
      <dt :class="NAME">{{ t('ui.issuedDocuments.customer') }}</dt>
      <dd :class="CHOSEN">
        <span class="min-w-0 font-medium">{{ customer.displayName }}</span>
        <Button type="button" variant="ghost" :class="TOUCH" @click="customer = null">
          {{ t('ui.documentTemplates.fill.changeCustomer') }}
        </Button>
      </dd>
    </dl>
    <CustomerPicker v-else @select="chooseCustomer" />
    <p v-if="errors.customerId" :class="ERROR">
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ errors.customerId }}
    </p>

    <template v-if="customer">
      <p v-if="fields.length === 0" :class="HINT">
        {{ t('ui.documentTemplates.fill.noFields') }}
      </p>
      <div
        v-for="field in fields"
        :key="field.key"
        :data-field="field.key"
        class="flex flex-col gap-1.5"
      >
        <template v-if="field.type === 'site' || field.type === 'item'">
          <dl v-if="chosen[field.key]" class="m-0 flex flex-col gap-1.5">
            <dt :class="NAME">{{ field.label }}</dt>
            <dd :class="CHOSEN">
              <span class="min-w-0">{{ chosen[field.key]!.label }}</span>
              <Button
                type="button"
                variant="ghost"
                :class="TOUCH"
                :aria-label="t('ui.documentTemplates.fill.changeField', { field: field.label })"
                @click="chosen[field.key] = null"
              >
                {{ t('ui.documentTemplates.fill.change') }}
              </Button>
            </dd>
          </dl>
          <SitePicker
            v-else-if="field.type === 'site'"
            :key="customer.id"
            :customer-id="customer.id"
            :label="field.label"
            @select="(picked) => (chosen[field.key] = { id: picked.id, label: picked.summary })"
          />
          <ItemPicker
            v-else
            :label="field.label"
            @select="(picked) => (chosen[field.key] = { id: picked.id, label: picked.description })"
          />
        </template>

        <template v-else-if="field.type === 'equipment' || field.type === 'job'">
          <FormField
            :id="idOf(field.key)"
            v-slot="control"
            :label="field.label"
            :error="selectError(field)"
            :hint="selectHint(field)"
          >
            <NativeSelect
              :id="control.id"
              :model-value="String(chosen[field.key]?.id ?? '')"
              :aria-invalid="control.invalid"
              :aria-describedby="control.describedBy"
              @update:model-value="(id) => choose(field, id ?? '')"
            >
              <option value="">{{ t('ui.documentTemplates.fill.none') }}</option>
              <option
                v-for="option in options[field.type]"
                :key="option.id"
                :value="String(option.id)"
              >
                {{ option.label }}
              </option>
            </NativeSelect>
          </FormField>
          <div
            v-if="field.type === 'job' && chosen[field.key] && loadsFromJob"
            class="flex flex-wrap items-center gap-2"
          >
            <Button type="button" variant="outline" :class="TOUCH" @click="loadFromJob">
              {{ t('ui.documentTemplates.fill.loadFromJob') }}
            </Button>
            <span v-if="loaded !== null" role="status" :class="HINT">
              {{ t('ui.documentTemplates.fill.loadedFromJob', { count: loaded }) }}
            </span>
            <span v-if="loadFailed" :class="ERROR">
              <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
              {{ t('ui.documentTemplates.fill.loadFailed') }}
            </span>
          </div>
        </template>

        <template v-else-if="field.type === 'items'">
          <ItemPicker
            :label="field.label"
            @select="
              (picked) =>
                (lists[field.key] = [
                  ...(lists[field.key] ?? []),
                  { id: picked.id, label: picked.description },
                ])
            "
          />
          <ul
            v-if="lists[field.key]?.length"
            :aria-label="field.label"
            class="m-0 list-none rounded-sm border-x border-b border-border p-0"
          >
            <li
              v-for="(item, index) in lists[field.key]"
              :key="index"
              class="flex items-center justify-between gap-2 border-t border-border py-1 pr-1 pl-3 text-sm"
            >
              {{ item.label }}
              <Button
                type="button"
                variant="ghost"
                :class="TOUCH"
                :aria-label="t('ui.documentTemplates.fill.removeItem', { item: item.label })"
                @click="lists[field.key].splice(index, 1)"
              >
                {{ t('ui.documentTemplates.fill.remove') }}
              </Button>
            </li>
          </ul>
        </template>

        <template v-else-if="field.type === 'table'">
          <p :class="NAME">{{ field.label }}</p>
          <!-- On desktop the heads name the columns once; on the phone each cell shows its name -->
          <div class="rounded-sm border-x border-b border-border">
            <RowHeads
              v-if="rows[field.key]?.length"
              :heads="(field.columns ?? []).map((column) => ({ label: column.label, class: CELL }))"
            />
            <p v-else :class="EMPTY">{{ t('ui.documentTemplates.fill.noRows') }}</p>
            <ul class="m-0 list-none p-0">
              <li v-for="(row, r) in rows[field.key] ?? []" :key="r" :class="EDIT_ROW">
                <div class="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:flex-wrap">
                  <RowField
                    v-for="(column, c) in field.columns"
                    :key="column.key"
                    :label="column.label"
                    :class="CELL"
                  >
                    <Input
                      v-model="row[c]"
                      :type="column.type === 'date' ? 'date' : 'text'"
                      :inputmode="column.type === 'number' ? 'decimal' : undefined"
                      :aria-label="
                        t('ui.documentTemplates.fill.cellOf', { column: column.label, row: r + 1 })
                      "
                      :class="TOUCH"
                    />
                  </RowField>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  :class="[TOUCH, 'self-start']"
                  @click="rows[field.key].splice(r, 1)"
                >
                  {{ t('ui.documentTemplates.fill.removeRow', { row: r + 1 }) }}
                </Button>
              </li>
            </ul>
          </div>
          <Button
            type="button"
            variant="outline"
            :class="[TOUCH, 'self-start']"
            @click="addRow(field)"
          >
            {{ t('ui.documentTemplates.fill.addRow') }}
          </Button>
        </template>

        <fieldset
          v-else-if="field.type === 'work_report'"
          class="m-0 flex min-w-0 flex-col gap-3 rounded-sm border border-border p-3 md:p-4"
        >
          <legend :class="[NAME, 'px-1']">{{ field.label }}</legend>
          <p v-if="!job" :class="HINT">{{ t('ui.documentTemplates.fill.noJobYet') }}</p>
          <div class="flex flex-col gap-3 md:flex-row">
            <FormField
              :id="idOf(field.key, '-from')"
              v-slot="control"
              :label="t('ui.documentTemplates.fill.workReportFrom')"
              class="md:w-44"
            >
              <Input
                :id="control.id"
                v-model="reports[field.key].from"
                type="date"
                :aria-describedby="idOf(field.key, '-period')"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              :id="idOf(field.key, '-to')"
              v-slot="control"
              :label="t('ui.documentTemplates.fill.workReportTo')"
              class="md:w-44"
            >
              <Input
                :id="control.id"
                v-model="reports[field.key].to"
                type="date"
                :aria-describedby="idOf(field.key, '-period')"
                :class="TOUCH"
              />
            </FormField>
          </div>
          <p :id="idOf(field.key, '-period')" :class="HINT">
            {{ t('ui.documentTemplates.fill.workReportPeriodHint') }}
          </p>
          <label :class="CHECK">
            <input v-model="reports[field.key].prices" type="checkbox" class="size-4" />
            {{ t('ui.documentTemplates.fill.workReportPrices') }}
          </label>
          <label :class="CHECK">
            <input v-model="reports[field.key].notes" type="checkbox" class="size-4" />
            {{ t('ui.documentTemplates.fill.workReportNotes') }}
          </label>
          <label :class="CHECK">
            <input v-model="reports[field.key].jobCharges" type="checkbox" class="size-4" />
            {{ t('ui.documentTemplates.fill.workReportJobCharges') }}
          </label>
        </fieldset>

        <label v-else-if="field.type === 'boolean'" :class="CHECK">
          <input v-model="checks[field.key]" type="checkbox" class="size-4" />
          {{ field.label }}
        </label>

        <FormField
          v-else
          :id="idOf(field.key)"
          v-slot="control"
          :label="field.label"
          :error="errors[field.key]"
        >
          <NativeSelect
            v-if="field.type === 'choice'"
            :id="control.id"
            v-model="texts[field.key]"
            :aria-invalid="control.invalid"
            :aria-describedby="control.describedBy"
          >
            <option value="">{{ t('ui.documentTemplates.fill.none') }}</option>
            <option v-for="option in field.options" :key="option" :value="option">
              {{ option }}
            </option>
          </NativeSelect>
          <Textarea
            v-else-if="field.type === 'long_text'"
            :id="control.id"
            v-model="texts[field.key]"
            :aria-invalid="control.invalid"
            :aria-describedby="control.describedBy"
            rows="4"
          />
          <Input
            v-else
            :id="control.id"
            v-model="texts[field.key]"
            :type="field.type === 'date' ? 'date' : 'text'"
            :inputmode="field.type === 'number' ? 'decimal' : undefined"
            :aria-invalid="control.invalid"
            :aria-describedby="control.describedBy"
            :class="TOUCH"
          />
        </FormField>

        <!-- The error of a field whose control doesn't show it -->
        <p v-if="errors[field.key] && !OWN_ERROR.has(field.type)" :class="ERROR">
          <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
          {{ errors[field.key] }}
        </p>
      </div>
    </template>
    <p v-else :class="HINT">{{ t('ui.documentTemplates.fill.chooseCustomerFirst') }}</p>
  </div>
</template>
