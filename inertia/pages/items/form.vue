<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatMoney, t } from '~/i18n'
import { urlFor } from '~/client'
import { amountForInput, markupPercent, parseAmount, suggestedResalePrice } from '@shared/money'

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
  purchasePrice: string
  resalePrice: string
  archived: boolean
  reorderLevel: string | null
  maintenanceIntervalMonths: number | null
}

const props = defineProps<{
  item: ItemProps | null
  documents: { id: number; title: string; originalName: string; sizeBytes: number }[]
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
  vatCodeId: props.item?.vatCodeId ?? props.vatCodes[0]?.id,
  significantGood: props.item?.significantGood ?? false,
  reorderLevel: props.item?.reorderLevel
    ? amountForInput(props.item.reorderLevel).replace(/,?0+$/, '').replace(/,$/, '')
    : '',
  maintenanceIntervalMonths: String(props.item?.maintenanceIntervalMonths ?? ''),
})
const categoryId = ref<number | ''>(props.item?.categoryId ?? '')
const purchasePrice = ref(props.item ? amountForInput(props.item.purchasePrice) : '')
const resalePrice = ref(props.item ? amountForInput(props.item.resalePrice) : '')

/**
 * On a new Item the resale price follows the suggestion until the person
 * types their own. Saved Items are never changed automatically.
 */
const followSuggestion = ref(props.item === null)

const category = computed(() => props.categories.find((c) => c.id === categoryId.value))

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

function useSuggestion() {
  if (suggestion.value) resalePrice.value = amountForInput(suggestion.value)
}

const percent = (value: string) => amountForInput(value).replace(/,00$/, '')
const title = props.item ? t('ui.items.editTitle') : t('ui.items.newTitle')
</script>

<template>
  <AppLayout>
    <Page :title="title">
      <Form
        v-slot="{ processing, errors }"
        :route="item ? 'items.update' : 'items.store'"
        :params="item ? { id: item.id } : undefined"
      >
        <Section :title="t('ui.items.itemSection')">
          <div class="field">
            <label class="field__label" for="code">{{ t('ui.items.code') }}</label>
            <input id="code" v-model="values.code" name="code" class="field__input mono" />
            <span v-if="errors.code" class="field__error">{{ errors.code }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="description">{{ t('ui.items.description') }}</label>
            <textarea
              id="description"
              v-model="values.description"
              name="description"
              class="field__input"
              rows="2"
            />
            <span v-if="errors.description" class="field__error">{{ errors.description }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="unit">{{ t('ui.items.unit') }}</label>
            <input
              id="unit"
              v-model="values.unit"
              name="unit"
              list="units"
              class="field__input"
              :style="{ maxWidth: '120px' }"
            />
            <datalist id="units">
              <option
                v-for="unit in ['pz', 'm', 'm²', 'kg', 'l', 'conf', 'h']"
                :key="unit"
                :value="unit"
              />
            </datalist>
            <span class="field__hint">{{ t('ui.items.unitHint') }}</span>
            <span v-if="errors.unit" class="field__error">{{ errors.unit }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="categoryId">{{ t('ui.items.category') }}</label>
            <select id="categoryId" v-model="categoryId" name="categoryId" class="field__input">
              <option value="">{{ t('ui.items.noCategory') }}</option>
              <option v-for="option in categories" :key="option.id" :value="option.id">
                {{ option.name }} ({{ percent(option.markupPercent) }} %)
              </option>
            </select>
          </div>
        </Section>

        <Section :title="t('ui.items.supplierSection')">
          <div class="field">
            <label class="field__label" for="supplierName">{{ t('ui.items.supplierName') }}</label>
            <input
              id="supplierName"
              v-model="values.supplierName"
              name="supplierName"
              class="field__input"
            />
          </div>
          <div class="field">
            <label class="field__label" for="supplierCode">{{ t('ui.items.supplierCode') }}</label>
            <input
              id="supplierCode"
              v-model="values.supplierCode"
              name="supplierCode"
              class="field__input mono"
            />
          </div>
        </Section>

        <Section :title="t('ui.items.pricesSection')" :description="t('ui.items.pricesHint')">
          <div class="field">
            <label class="field__label" for="vatCodeId">{{ t('ui.items.vatCode') }}</label>
            <select
              id="vatCodeId"
              v-model="values.vatCodeId"
              name="vatCodeId"
              class="field__input"
              :style="{ maxWidth: '360px' }"
            >
              <option v-for="code in vatCodes" :key="code.id" :value="code.id">
                {{ code.name }}
              </option>
            </select>
            <span class="field__hint">{{ t('ui.items.vatCodeHint') }}</span>
            <span v-if="errors.vatCodeId" class="field__error">{{ errors.vatCodeId }}</span>
          </div>
          <div class="field">
            <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
              <input
                v-model="values.significantGood"
                type="checkbox"
                name="significantGood"
                value="true"
              />
              {{ t('ui.items.significantGood') }}
            </label>
            <span class="field__hint">{{ t('ui.items.significantGoodHint') }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="purchasePrice">{{
              t('ui.items.purchasePrice')
            }}</label>
            <input
              id="purchasePrice"
              v-model="purchasePrice"
              name="purchasePrice"
              inputmode="decimal"
              class="field__input"
              :style="{ maxWidth: '180px' }"
            />
            <span v-if="errors.purchasePrice" class="field__error">{{ errors.purchasePrice }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="resalePrice">{{ t('ui.items.resalePrice') }}</label>
            <input
              id="resalePrice"
              v-model="resalePrice"
              name="resalePrice"
              inputmode="decimal"
              class="field__input"
              :style="{ maxWidth: '180px' }"
              @input="onResaleInput"
            />
            <span v-if="suggestion && category" class="field__hint">
              {{
                t('ui.items.suggested', {
                  markup: percent(category.markupPercent),
                  price: formatMoney(suggestion),
                })
              }}
              <button
                v-if="amountForInput(suggestion) !== resalePrice"
                type="button"
                class="btn btn--ghost btn--sm"
                @click="useSuggestion"
              >
                {{ t('ui.items.useSuggested') }}
              </button>
            </span>
            <span v-if="currentMarkup" class="field__hint">
              {{ t('ui.items.markup', { markup: percent(currentMarkup) }) }}
            </span>
            <span v-if="errors.resalePrice" class="field__error">{{ errors.resalePrice }}</span>
          </div>
        </Section>

        <Section :title="t('ui.items.stock')">
          <div class="field">
            <label class="field__label" for="reorderLevel">{{ t('ui.items.reorderLevel') }}</label>
            <input
              id="reorderLevel"
              v-model="values.reorderLevel"
              name="reorderLevel"
              inputmode="decimal"
              class="field__input"
              :style="{ maxWidth: '180px' }"
            />
            <span class="field__hint">{{ t('ui.items.reorderLevelHint') }}</span>
            <span v-if="errors.reorderLevel" class="field__error">{{ errors.reorderLevel }}</span>
          </div>
        </Section>

        <Section :title="t('ui.items.maintenanceSection')">
          <div class="field">
            <label class="field__label" for="maintenanceIntervalMonths">
              {{ t('ui.items.maintenanceInterval') }}
            </label>
            <input
              id="maintenanceIntervalMonths"
              v-model="values.maintenanceIntervalMonths"
              name="maintenanceIntervalMonths"
              type="number"
              min="1"
              max="120"
              class="field__input"
              :style="{ maxWidth: '120px' }"
            />
            <span class="field__hint">{{ t('ui.items.maintenanceIntervalHint') }}</span>
            <span v-if="errors.maintenanceIntervalMonths" class="field__error">
              {{ errors.maintenanceIntervalMonths }}
            </span>
          </div>
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.items.save') }}
          </button>
        </Section>
      </Form>

      <Section
        v-if="item"
        :title="t('ui.items.documentsTitle')"
        :description="t('ui.items.documentsDescription')"
      >
        <table v-if="documents.length" class="table">
          <tbody>
            <tr v-for="document in documents" :key="document.id">
              <td>
                <a
                  :href="urlFor('item_documents.show', { id: document.id })"
                  target="_blank"
                  rel="noopener"
                  class="il"
                >
                  {{ document.title }}
                </a>
                <span class="field__hint">
                  · {{ document.originalName }} · {{ Math.ceil(document.sizeBytes / 1024) }} KB
                </span>
              </td>
              <td class="table__actions">
                <Form route="item_documents.destroy" :params="{ id: document.id }">
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.common.delete') }}
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.items.noDocuments') }}</p>

        <Form
          v-slot="{ processing, errors }"
          route="item_documents.store"
          :params="{ id: item.id }"
          reset-on-success
          :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }"
        >
          <div class="field">
            <label class="field__label" for="document-title">{{
              t('ui.items.documentTitle')
            }}</label>
            <input id="document-title" name="title" class="field__input" />
            <span v-if="errors.title" class="field__error">{{ errors.title }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="document-file">{{ t('ui.items.documentFile') }}</label>
            <input
              id="document-file"
              name="attachment"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
            />
            <span v-if="errors.attachment" class="field__error">{{ errors.attachment }}</span>
          </div>
          <button
            type="submit"
            class="btn btn--secondary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.items.upload') }}
          </button>
        </Form>
      </Section>

      <Section v-if="item">
        <p v-if="item.archived" class="field__hint">{{ t('ui.items.archivedNotice') }}</p>
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
          <Form
            :route="item.archived ? 'items.unarchive' : 'items.archive'"
            :params="{ id: item.id }"
          >
            <button type="submit" class="btn btn--secondary btn--sm">
              {{ item.archived ? t('ui.items.unarchive') : t('ui.items.archive') }}
            </button>
          </Form>
          <Form route="items.destroy" :params="{ id: item.id }">
            <button type="submit" class="btn btn--ghost btn--sm">{{ t('ui.items.delete') }}</button>
          </Form>
        </div>
      </Section>
    </Page>
  </AppLayout>
</template>
