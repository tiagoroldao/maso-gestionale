<script setup lang="ts">
import { computed } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, formatUnitPrice, t, todayIso } from '~/i18n'
import { amountForInput } from '@shared/money'

const props = defineProps<{
  item: {
    id: number
    code: string
    description: string
    unit: string
    category: string | null
    supplierName: string | null
    supplierCode: string | null
    purchasePrice: string
    resalePrice: string
    reorderLevel: string | null
    belowMarkup: boolean
    markupPercent: string | null
  }
  stock: string
  movements: {
    id: number
    kind: string
    quantity: string
    unitCost: string | null
    occurredOn: string
    reference: string | null
    reason: string | null
    author: string | null
  }[]
}>()

/**
 * Quantities as people write them: "2,5" rather than "2.500".
 */
function percent(value: string) {
  return amountForInput(value).replace(/,00$/, '')
}

function quantity(value: string) {
  return amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')
}

const today = todayIso()
// Recomputed after each recorded movement (the page is reused, not remounted)
const isNegative = computed(() => props.stock.startsWith('-'))
</script>

<template>
  <AppLayout>
    <Page :title="`${item.code} · ${item.description}`">
      <template #actions>
        <Link route="items.edit" :params="{ id: item.id }" class="btn btn--secondary btn--sm">
          <Pencil :size="15" /> {{ t('ui.common.edit') }}
        </Link>
      </template>

      <Section :title="t('ui.items.details')">
        <dl class="details">
          <dt>{{ t('ui.items.stock') }}</dt>
          <dd>
            <strong>{{ quantity(stock) }} {{ item.unit }}</strong>
            <span v-if="isNegative" class="tag">{{ t('ui.items.negativeStock') }}</span>
          </dd>
          <template v-if="item.reorderLevel">
            <dt>{{ t('ui.items.reorderLevel') }}</dt>
            <dd>{{ quantity(item.reorderLevel) }} {{ item.unit }}</dd>
          </template>
          <template v-if="item.category">
            <dt>{{ t('ui.items.category') }}</dt>
            <dd>{{ item.category }}</dd>
          </template>
          <template v-if="item.supplierName || item.supplierCode">
            <dt>{{ t('ui.items.supplierName') }}</dt>
            <dd>{{ [item.supplierName, item.supplierCode].filter(Boolean).join(' · ') }}</dd>
          </template>
          <dt>{{ t('ui.items.purchasePrice') }}</dt>
          <dd>{{ formatUnitPrice(item.purchasePrice) }}/{{ item.unit }}</dd>
          <dt>{{ t('ui.items.resalePrice') }}</dt>
          <dd>{{ formatUnitPrice(item.resalePrice) }}/{{ item.unit }}</dd>
        </dl>
        <p v-if="item.belowMarkup && item.markupPercent" class="field__error">
          {{ t('ui.items.belowMarkup', { markup: percent(item.markupPercent) }) }}
        </p>
      </Section>

      <Section :title="t('ui.items.receiptTitle')" :description="t('ui.items.receiptDescription')">
        <Form
          v-slot="{ processing, errors }"
          route="stock_movements.receive"
          :params="{ id: item.id }"
          reset-on-success
          :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }"
        >
          <div class="field">
            <label class="field__label" for="receipt-quantity">{{ t('ui.items.quantity') }}</label>
            <input id="receipt-quantity" name="quantity" inputmode="decimal" class="field__input" />
            <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="receipt-unit-cost">{{ t('ui.items.unitCost') }}</label>
            <input
              id="receipt-unit-cost"
              name="unitCost"
              inputmode="decimal"
              class="field__input"
            />
            <span v-if="errors.unitCost" class="field__error">{{ errors.unitCost }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="receipt-date">{{ t('ui.items.date') }}</label>
            <input
              id="receipt-date"
              name="occurredOn"
              type="date"
              :max="today"
              :value="today"
              class="field__input"
            />
            <span v-if="errors.occurredOn" class="field__error">{{ errors.occurredOn }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="receipt-reference">
              {{ t('ui.items.receiptReference') }}
            </label>
            <input id="receipt-reference" name="reference" class="field__input" />
          </div>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.items.receive') }}
          </button>
        </Form>
      </Section>

      <Section
        :title="t('ui.items.adjustmentTitle')"
        :description="t('ui.items.adjustmentDescription')"
      >
        <Form
          v-slot="{ processing, errors }"
          route="stock_movements.adjust"
          :params="{ id: item.id }"
          reset-on-success
          :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }"
        >
          <div class="field">
            <label class="field__label" for="adjustment-quantity">
              {{ t('ui.items.quantity') }}
            </label>
            <input
              id="adjustment-quantity"
              name="quantity"
              inputmode="decimal"
              class="field__input"
            />
            <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
          </div>
          <div class="field" :style="{ flex: '1 1 240px' }">
            <label class="field__label" for="adjustment-reason">{{ t('ui.items.reason') }}</label>
            <input id="adjustment-reason" name="reason" class="field__input" />
            <span v-if="errors.reason" class="field__error">{{ errors.reason }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="adjustment-date">{{ t('ui.items.date') }}</label>
            <input
              id="adjustment-date"
              name="occurredOn"
              type="date"
              :max="today"
              :value="today"
              class="field__input"
            />
            <span v-if="errors.occurredOn" class="field__error">{{ errors.occurredOn }}</span>
          </div>
          <button
            type="submit"
            class="btn btn--secondary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.items.adjust') }}
          </button>
        </Form>
      </Section>

      <Section :title="t('ui.items.movementsTitle')">
        <table v-if="movements.length" class="table">
          <thead>
            <tr>
              <th>{{ t('ui.items.date') }}</th>
              <th>{{ t('ui.items.kind') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.quantity') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.unitCost') }}</th>
              <th>{{ t('ui.items.reference') }} / {{ t('ui.items.reason') }}</th>
              <th>{{ t('ui.items.author') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="movement in movements" :key="movement.id">
              <td>{{ formatDate(movement.occurredOn) }}</td>
              <td>{{ t(`ui.items.kinds.${movement.kind}`) }}</td>
              <td :style="{ textAlign: 'right' }">
                {{ movement.quantity.startsWith('-') ? '' : '+' }}{{ quantity(movement.quantity) }}
              </td>
              <td :style="{ textAlign: 'right' }">
                {{ movement.unitCost ? formatUnitPrice(movement.unitCost) : '' }}
              </td>
              <td>{{ [movement.reference, movement.reason].filter(Boolean).join(' · ') }}</td>
              <td>{{ movement.author }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.items.noMovements') }}</p>
      </Section>
    </Page>
  </AppLayout>
</template>
