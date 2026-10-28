<script setup lang="ts">
/**
 * Fills a Document Template's fields for a Customer: a value per field,
 * with Sites, Installed Equipment and Jobs offered as the server scopes
 * them, and "load from Job" for Item and table fields. `input()` gives
 * what the server checks and prints (services/template_data.ts).
 */
import { computed, reactive, ref, watch } from 'vue'
import CustomerPicker, { type PickedCustomer } from '~/components/customer_picker.vue'
import ItemPicker from '~/components/item_picker.vue'
import SitePicker from '~/components/site_picker.vue'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import type { TemplateField } from '@shared/document_templates'

type Choice = { id: number; label: string }
type ItemUsed = { id: number; code: string; description: string; unit: string; quantity: string }

const props = defineProps<{ fields: TemplateField[]; errors: Record<string, string> }>()

const customer = ref<PickedCustomer | null>(null)
// One store per kind of value, by field key; without a prototype, so a
// field keyed `constructor` starts empty
const store = <T,>() => reactive<Record<string, T>>(Object.create(null))
const texts = store<string>()
const checks = store<boolean>()
const chosen = store<Choice | null>()
const lists = store<Choice[]>()
const rows = store<string[][]>()

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
  } catch {
    failed.equipment = true
  }
})

async function chooseCustomer(picked: PickedCustomer) {
  customer.value = picked
  // Sites, Equipment and Jobs depend on the Customer
  for (const field of props.fields) {
    if (['site', 'equipment', 'job'].includes(field.type)) chosen[field.key] = null
  }
  options.job = []
  failed.job = false
  loaded.value = null
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

defineExpose({ input })
</script>

<template>
  <div v-if="customer" class="field">
    <span class="field__label">{{ t('ui.customers.picker.label') }}</span>
    <p>
      {{ customer.displayName }}
      <button type="button" class="btn btn--ghost btn--sm" @click="customer = null">
        {{ t('ui.documentTemplates.fill.changeCustomer') }}
      </button>
    </p>
  </div>
  <CustomerPicker v-else @select="chooseCustomer" />
  <span v-if="errors.customerId" class="field__error">{{ errors.customerId }}</span>

  <template v-if="customer">
    <p v-if="fields.length === 0" class="field__hint">
      {{ t('ui.documentTemplates.fill.noFields') }}
    </p>
    <div v-for="field in fields" :key="field.key" :data-field="field.key">
      <template v-if="field.type === 'site' || field.type === 'item'">
        <div v-if="chosen[field.key]" class="field">
          <span class="field__label">{{ field.label }}</span>
          <p>
            {{ chosen[field.key]!.label }}
            <button type="button" class="btn btn--ghost btn--sm" @click="chosen[field.key] = null">
              {{ t('ui.documentTemplates.fill.change') }}
            </button>
          </p>
        </div>
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

      <div v-else-if="field.type === 'equipment' || field.type === 'job'" class="field">
        <label class="field__label" :for="`fill-${field.key}`">{{ field.label }}</label>
        <select
          :id="`fill-${field.key}`"
          class="field__input"
          :value="chosen[field.key]?.id ?? ''"
          @change="choose(field, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ t('ui.documentTemplates.fill.none') }}</option>
          <option v-for="option in options[field.type]" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
        <p v-if="failed[field.type]" class="field__error">
          {{ t('ui.documentTemplates.fill.loadFailed') }}
        </p>
        <p v-else-if="field.type === 'equipment' && !site" class="field__hint">
          {{ t('ui.documentTemplates.fill.noSiteYet') }}
        </p>
        <p v-else-if="options[field.type].length === 0" class="field__hint">
          {{
            t(
              field.type === 'job'
                ? 'ui.documentTemplates.fill.noJobs'
                : 'ui.documentTemplates.fill.noEquipment'
            )
          }}
        </p>
        <p v-if="field.type === 'job' && chosen[field.key] && loadsFromJob">
          <button type="button" class="btn btn--secondary btn--sm" @click="loadFromJob">
            {{ t('ui.documentTemplates.fill.loadFromJob') }}
          </button>
          <span v-if="loaded !== null" class="field__hint">
            {{ t('ui.documentTemplates.fill.loadedFromJob', { count: loaded }) }}
          </span>
          <span v-if="loadFailed" class="field__error">
            {{ t('ui.documentTemplates.fill.loadFailed') }}
          </span>
        </p>
      </div>

      <div v-else-if="field.type === 'items'" class="field">
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
        <ul v-if="lists[field.key]?.length">
          <li v-for="(item, index) in lists[field.key]" :key="index">
            {{ item.label }}
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              @click="lists[field.key].splice(index, 1)"
            >
              {{ t('ui.documentTemplates.fill.remove') }}
            </button>
          </li>
        </ul>
      </div>

      <div v-else-if="field.type === 'table'" class="field">
        <span class="field__label">{{ field.label }}</span>
        <table class="table">
          <thead>
            <tr>
              <th v-for="column in field.columns" :key="column.key">{{ column.label }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in rows[field.key] ?? []" :key="r">
              <td v-for="(column, c) in field.columns" :key="column.key">
                <input
                  v-model="row[c]"
                  class="field__input"
                  :type="column.type === 'date' ? 'date' : 'text'"
                  :inputmode="column.type === 'number' ? 'decimal' : undefined"
                  :aria-label="
                    t('ui.documentTemplates.fill.cellOf', { column: column.label, row: r + 1 })
                  "
                />
              </td>
              <td class="table__actions">
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  @click="rows[field.key].splice(r, 1)"
                >
                  {{ t('ui.documentTemplates.fill.removeRow', { row: r + 1 }) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn btn--secondary btn--sm" @click="addRow(field)">
          {{ t('ui.documentTemplates.fill.addRow') }}
        </button>
      </div>

      <div v-else-if="field.type === 'boolean'" class="field">
        <label>
          <input v-model="checks[field.key]" type="checkbox" />
          {{ field.label }}
        </label>
      </div>

      <div v-else class="field">
        <label class="field__label" :for="`fill-${field.key}`">{{ field.label }}</label>
        <select
          v-if="field.type === 'choice'"
          :id="`fill-${field.key}`"
          v-model="texts[field.key]"
          class="field__input"
        >
          <option value="">{{ t('ui.documentTemplates.fill.none') }}</option>
          <option v-for="option in field.options" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
        <textarea
          v-else-if="field.type === 'long_text'"
          :id="`fill-${field.key}`"
          v-model="texts[field.key]"
          class="field__input"
          rows="4"
        />
        <input
          v-else
          :id="`fill-${field.key}`"
          v-model="texts[field.key]"
          class="field__input"
          :type="field.type === 'date' ? 'date' : 'text'"
          :inputmode="field.type === 'number' ? 'decimal' : undefined"
        />
      </div>

      <span v-if="errors[field.key]" class="field__error">{{ errors[field.key] }}</span>
    </div>
  </template>
</template>
