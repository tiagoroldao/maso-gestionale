<script setup lang="ts">
/**
 * An Item in edit mode (docs/ui.md "Kinds of screen"): the Item screen
 * wrapped in its form, Save its primary action. The resale price follows
 * the Category's markup on a new Item until typed; archiving, deleting and
 * documents are on the Item's page.
 */
import { computed, reactive, ref, watch } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { formatMoney, t } from '~/i18n'
import { urlFor } from '~/client'
import { amountForInput, markupPercent, parseAmount, suggestedResalePrice } from '@shared/money'
import { itemFlagDefaults } from '@shared/items'
import type { ScreenAction } from '@shared/screen_actions'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import FormField from '~/components/screen/form_field.vue'
import type { Crumb } from '~/components/screen/screen'

type ItemProps = {
  id: number
  code: string
  description: string
  unit: string
  categoryId: number | null
  supplierName: string | null
  supplierCode: string | null
  vatCodeId: number
  significantGood: boolean
  equipment: boolean
  groupable: boolean
  purchasePrice: string
  resalePrice: string
  archived: boolean
  reorderLevel: string | null
  maintenanceIntervalMonths: number | null
}

const props = defineProps<{
  // Save, the screen's primary
  actions: ScreenAction[]
  item: ItemProps | null
  categories: { id: number; name: string; markupPercent: string }[]
  vatCodes: { id: number; name: string }[]
}>()

/**
 * Field values live in reactive state (not one-way :value bindings), so
 * the live price suggestion can re-render the form without wiping fields.
 */
const values = reactive({
  code: props.item?.code ?? '',
  description: props.item?.description ?? '',
  unit: props.item?.unit ?? 'pz',
  supplierName: props.item?.supplierName ?? '',
  supplierCode: props.item?.supplierCode ?? '',
  vatCodeId: String(props.item?.vatCodeId ?? props.vatCodes[0]?.id ?? ''),
  significantGood: props.item?.significantGood ?? false,
  reorderLevel: props.item?.reorderLevel
    ? amountForInput(props.item.reorderLevel).replace(/,?0+$/, '').replace(/,$/, '')
    : '',
  maintenanceIntervalMonths: String(props.item?.maintenanceIntervalMonths ?? ''),
  equipment: props.item?.equipment ?? false,
  groupable: props.item?.groupable ?? true,
})
const categoryId = ref(String(props.item?.categoryId ?? ''))
const purchasePrice = ref(props.item ? amountForInput(props.item.purchasePrice) : '')
const resalePrice = ref(props.item ? amountForInput(props.item.resalePrice) : '')

/**
 * On a new Item the resale price follows the suggestion until the person
 * types their own. Saved Items are never changed automatically.
 */
const followSuggestion = ref(props.item === null)

const category = computed(() => props.categories.find((c) => String(c.id) === categoryId.value))

const suggestion = computed(() => {
  const purchase = parseAmount(purchasePrice.value)
  if (!purchase || !category.value) return null
  return suggestedResalePrice(purchase.toFixed(), category.value.markupPercent)
})

const currentMarkup = computed(() => {
  const purchase = parseAmount(purchasePrice.value)
  const resale = parseAmount(resalePrice.value)
  if (!purchase || !resale) return null
  return markupPercent(purchase.toFixed(), resale.toFixed())
})

watch(suggestion, (value) => {
  if (followSuggestion.value && value) resalePrice.value = amountForInput(value)
})

function onResaleInput() {
  followSuggestion.value = false
}

/**
 * Likewise, a new Item's Equipment and Groupable flags follow their
 * defaults (#176) until the person ticks either. Saved Items keep theirs.
 */
const followFlagDefaults = ref(props.item === null)

watch(
  () => [values.maintenanceIntervalMonths, values.significantGood] as const,
  ([interval, significantGood]) => {
    if (!followFlagDefaults.value) return
    Object.assign(
      values,
      itemFlagDefaults({
        maintenanceIntervalMonths: interval ? Number(interval) : null,
        significantGood,
      })
    )
  }
)

function onFlagInput() {
  followFlagDefaults.value = false
}

function useSuggestion() {
  if (suggestion.value) resalePrice.value = amountForInput(suggestion.value)
}

const percent = (value: string) => amountForInput(value).replace(/,00$/, '')

// Where the screen sits: under the Item when editing it, under Articoli when new
const list: Crumb = { label: t('ui.items.title'), href: urlFor('items.index') }
const crumbs = props.item
  ? [list, { label: props.item.code, href: urlFor('items.show', { id: props.item.id }) }]
  : [list]
const title = props.item?.description ?? t('ui.items.newTitle')
const current = props.item ? t('ui.common.edit') : t('ui.items.newTitle')
const documentTitle = props.item ? t('ui.items.editTitle') : t('ui.items.newTitle')

const UNITS = ['pz', 'm', 'm²', 'kg', 'l', 'conf', 'h']
const GRID = 'grid gap-4 md:grid-cols-2'
const INPUT = 'h-11 md:h-9'
const CHECK = 'flex min-h-11 items-center gap-2.5 text-sm font-medium md:min-h-0'
const HINT = 'm-0 text-[13px] text-muted-foreground'
</script>

<template>
  <AppLayout>
    <Form
      id="item-form"
      v-slot="{ errors }"
      :route="item ? 'items.update' : 'items.store'"
      :params="item ? { id: item.id } : undefined"
      class="w-full min-w-0"
    >
      <EntityScreen
        :document-title="documentTitle"
        :crumbs="crumbs"
        :current="current"
        :title="title"
        :facts="item?.code"
        :actions="actions"
      >
        <template v-if="item?.archived" #tags>
          <StatusTag tone="grey">{{ t('ui.items.archived') }}</StatusTag>
        </template>

        <template #main>
          <ScreenSection :title="t('ui.items.itemSection')">
            <div :class="GRID">
              <FormField id="code" v-slot="field" :label="t('ui.items.code')" :error="errors.code">
                <Input
                  :id="field.id"
                  v-model="values.code"
                  name="code"
                  :class="[INPUT, 'font-mono']"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="unit"
                v-slot="field"
                :label="t('ui.items.unit')"
                :hint="t('ui.items.unitHint')"
                :error="errors.unit"
              >
                <Input
                  :id="field.id"
                  v-model="values.unit"
                  name="unit"
                  list="units"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
                <datalist id="units">
                  <option v-for="unit in UNITS" :key="unit" :value="unit" />
                </datalist>
              </FormField>
            </div>
            <FormField
              id="description"
              v-slot="field"
              :label="t('ui.items.description')"
              :error="errors.description"
            >
              <textarea
                :id="field.id"
                v-model="values.description"
                name="description"
                rows="2"
                class="w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 font-sans text-base text-foreground outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive md:text-sm"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
            <FormField id="categoryId" v-slot="field" :label="t('ui.items.category')">
              <NativeSelect :id="field.id" v-model="categoryId" name="categoryId">
                <option value="">{{ t('ui.items.noCategory') }}</option>
                <option v-for="option in categories" :key="option.id" :value="String(option.id)">
                  {{ option.name }} ({{ percent(option.markupPercent) }} %)
                </option>
              </NativeSelect>
            </FormField>
          </ScreenSection>

          <ScreenSection :title="t('ui.items.pricesSection')">
            <p :class="HINT">{{ t('ui.items.pricesHint') }}</p>
            <div :class="GRID">
              <FormField
                id="purchasePrice"
                v-slot="field"
                :label="t('ui.items.purchasePrice')"
                :error="errors.purchasePrice"
              >
                <Input
                  :id="field.id"
                  v-model="purchasePrice"
                  name="purchasePrice"
                  inputmode="decimal"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="resalePrice"
                v-slot="field"
                :label="t('ui.items.resalePrice')"
                :hint="
                  currentMarkup
                    ? t('ui.items.markup', { markup: percent(currentMarkup) })
                    : undefined
                "
                :error="errors.resalePrice"
              >
                <Input
                  :id="field.id"
                  v-model="resalePrice"
                  name="resalePrice"
                  inputmode="decimal"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                  @input="onResaleInput"
                />
              </FormField>
            </div>
            <div v-if="suggestion && category" class="flex flex-wrap items-center gap-2">
              <p :class="HINT">
                {{
                  t('ui.items.suggested', {
                    markup: percent(category.markupPercent),
                    price: formatMoney(suggestion),
                  })
                }}
              </p>
              <Button
                v-if="amountForInput(suggestion) !== resalePrice"
                type="button"
                variant="outline"
                size="sm"
                :class="INPUT"
                @click="useSuggestion"
              >
                {{ t('ui.items.useSuggested') }}
              </Button>
            </div>
            <FormField
              id="vatCodeId"
              v-slot="field"
              :label="t('ui.items.vatCode')"
              :hint="t('ui.items.vatCodeHint')"
              :error="errors.vatCodeId"
            >
              <NativeSelect
                :id="field.id"
                v-model="values.vatCodeId"
                name="vatCodeId"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              >
                <option v-for="code in vatCodes" :key="code.id" :value="String(code.id)">
                  {{ code.name }}
                </option>
              </NativeSelect>
            </FormField>
            <div class="flex flex-col gap-1.5">
              <label :class="CHECK">
                <input
                  v-model="values.significantGood"
                  type="checkbox"
                  name="significantGood"
                  value="true"
                  class="size-4"
                  aria-describedby="significantGood-hint"
                />
                {{ t('ui.items.significantGood') }}
              </label>
              <p id="significantGood-hint" :class="HINT">
                {{ t('ui.items.significantGoodHint') }}
              </p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label :class="CHECK">
                <input
                  v-model="values.groupable"
                  type="checkbox"
                  name="groupable"
                  value="true"
                  class="size-4"
                  aria-describedby="groupable-hint"
                  @change="onFlagInput"
                />
                {{ t('ui.items.groupable') }}
              </label>
              <p id="groupable-hint" :class="HINT">{{ t('ui.items.groupableHint') }}</p>
            </div>
          </ScreenSection>
        </template>

        <template #side>
          <ScreenSection :title="t('ui.items.supplierSection')">
            <FormField id="supplierName" v-slot="field" :label="t('ui.items.supplierName')">
              <Input
                :id="field.id"
                v-model="values.supplierName"
                name="supplierName"
                :class="INPUT"
              />
            </FormField>
            <FormField id="supplierCode" v-slot="field" :label="t('ui.items.supplierCode')">
              <Input
                :id="field.id"
                v-model="values.supplierCode"
                name="supplierCode"
                :class="[INPUT, 'font-mono']"
              />
            </FormField>
          </ScreenSection>

          <ScreenSection :title="t('ui.items.warehouseSection')">
            <FormField
              id="reorderLevel"
              v-slot="field"
              :label="t('ui.items.reorderLevel')"
              :hint="t('ui.items.reorderLevelHint')"
              :error="errors.reorderLevel"
            >
              <Input
                :id="field.id"
                v-model="values.reorderLevel"
                name="reorderLevel"
                inputmode="decimal"
                :class="INPUT"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </ScreenSection>

          <ScreenSection :title="t('ui.items.maintenanceSection')">
            <FormField
              id="maintenanceIntervalMonths"
              v-slot="field"
              :label="t('ui.items.maintenanceInterval')"
              :hint="t('ui.items.maintenanceIntervalHint')"
              :error="errors.maintenanceIntervalMonths"
            >
              <Input
                :id="field.id"
                v-model="values.maintenanceIntervalMonths"
                name="maintenanceIntervalMonths"
                type="number"
                min="1"
                max="120"
                :class="INPUT"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
            <div class="flex flex-col gap-1.5">
              <label :class="CHECK">
                <input
                  v-model="values.equipment"
                  type="checkbox"
                  name="equipment"
                  value="true"
                  class="size-4"
                  aria-describedby="equipment-hint"
                  @change="onFlagInput"
                />
                {{ t('ui.items.equipment') }}
              </label>
              <p id="equipment-hint" :class="HINT">{{ t('ui.items.equipmentHint') }}</p>
            </div>
          </ScreenSection>
        </template>
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
