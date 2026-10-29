<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { amountForInput } from '@shared/money'
import { formatQuantity as quantity } from '@shared/stock'
import { formatUnitPrice, t } from '~/i18n'

type Row = {
  id: number
  code: string
  description: string
  unit: string
  inStock: string
  committed: string
  available: string
  reorderLevel: string | null
  reorder: 'negative' | 'low' | null
  purchasePrice: string
  resalePrice: string
  markupPercent: string | null
}

defineProps<{ toReorder: Row[]; belowMarkup: Row[] }>()
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.stock.title')">
      <Section
        :title="t('ui.stock.toReorderTitle')"
        :description="t('ui.stock.toReorderDescription')"
      >
        <table v-if="toReorder.length" class="table">
          <thead>
            <tr>
              <th>{{ t('ui.items.code') }}</th>
              <th>{{ t('ui.items.description') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.stock') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.committed') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.available') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.reorderLevel') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in toReorder" :key="row.id">
              <td class="mono">
                <Link route="items.show" :params="{ id: row.id }" class="il">{{ row.code }}</Link>
              </td>
              <td>{{ row.description }}</td>
              <td :style="{ textAlign: 'right' }">{{ quantity(row.inStock) }} {{ row.unit }}</td>
              <td :style="{ textAlign: 'right' }">{{ quantity(row.committed) }} {{ row.unit }}</td>
              <td :style="{ textAlign: 'right' }">
                {{ quantity(row.available) }} {{ row.unit }}
                <span class="tag">{{
                  row.reorder === 'negative' ? t('ui.stock.negative') : t('ui.stock.low')
                }}</span>
              </td>
              <td :style="{ textAlign: 'right' }">
                {{ row.reorderLevel ? `${quantity(row.reorderLevel)} ${row.unit}` : '' }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.stock.nothing') }}</p>
      </Section>

      <Section
        :title="t('ui.stock.belowMarkupTitle')"
        :description="t('ui.stock.belowMarkupDescription')"
      >
        <table v-if="belowMarkup.length" class="table">
          <thead>
            <tr>
              <th>{{ t('ui.items.code') }}</th>
              <th>{{ t('ui.items.description') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.purchasePrice') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.items.resalePrice') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.stock.categoryMarkup') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in belowMarkup" :key="row.id">
              <td class="mono">
                <Link route="items.show" :params="{ id: row.id }" class="il">{{ row.code }}</Link>
              </td>
              <td>{{ row.description }}</td>
              <td :style="{ textAlign: 'right' }">{{ formatUnitPrice(row.purchasePrice) }}</td>
              <td :style="{ textAlign: 'right' }">{{ formatUnitPrice(row.resalePrice) }}</td>
              <td :style="{ textAlign: 'right' }">
                {{
                  row.markupPercent
                    ? `${amountForInput(row.markupPercent).replace(/,00$/, '')} %`
                    : ''
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.stock.nothing') }}</p>
      </Section>
    </Page>
  </AppLayout>
</template>
