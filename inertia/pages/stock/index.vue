<script setup lang="ts">
/**
 * Giacenze: the Items that need attention (to reorder, or priced below
 * their Category's markup). A bespoke screen on the new UI (docs/ui.md
 * "Kinds of screen"): the header, then a section per concern, each a
 * table on desktop and a list of rows on the phone.
 */
import { Head } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { amountForInput } from '@shared/money'
import { formatQuantity as quantity } from '@shared/stock'
import { formatUnitPrice, t } from '~/i18n'
import { cn } from '~/lib/utils'
import ScreenHeader from '~/components/screen/screen_header.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import { LINK, ROW, TD, TH } from '~/components/screen/screen'

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

const withUnit = (value: string, unit: string) => `${quantity(value)} ${unit}`
const percent = (value: string) => `${amountForInput(value).replace(/,00$/, '')} %`
const reorderLabel = (row: Row) =>
  row.reorder === 'negative' ? t('ui.stock.negative') : t('ui.stock.low')

const DESCRIPTION = 'm-0 px-3.5 pb-3 text-[13px] text-muted-foreground md:px-4'
const EMPTY = 'm-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4'
const NUMBER = cn(TD, 'text-right whitespace-nowrap')
</script>

<template>
  <AppLayout>
    <div class="w-full min-w-0 bg-background">
      <Head :title="t('ui.stock.title')" />
      <ScreenHeader :crumbs="[]" :current="t('ui.stock.title')" :title="t('ui.stock.title')" />
      <div
        class="flex w-full max-w-[1220px] flex-col gap-3 p-3.5 pb-6 md:gap-5 md:px-8 md:pt-5 md:pb-10"
      >
        <ScreenSection :title="t('ui.stock.toReorderTitle')" flush>
          <p :class="DESCRIPTION">{{ t('ui.stock.toReorderDescription') }}</p>
          <template v-if="toReorder.length">
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full border-collapse" data-testid="to-reorder">
                <thead>
                  <tr>
                    <th :class="TH">{{ t('ui.items.code') }}</th>
                    <th :class="TH">{{ t('ui.items.description') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.stock') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.committed') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.available') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.reorderLevel') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in toReorder" :key="row.id">
                    <td :class="cn(TD, 'font-mono whitespace-nowrap')">
                      <Link route="items.show" :params="{ id: row.id }" :class="LINK">
                        {{ row.code }}
                      </Link>
                    </td>
                    <td :class="TD">{{ row.description }}</td>
                    <td :class="NUMBER">{{ withUnit(row.inStock, row.unit) }}</td>
                    <td :class="NUMBER">{{ withUnit(row.committed, row.unit) }}</td>
                    <td :class="NUMBER">
                      <span class="inline-flex items-center gap-2">
                        <span class="font-semibold">{{ withUnit(row.available, row.unit) }}</span>
                        <StatusTag tone="orange">{{ reorderLabel(row) }}</StatusTag>
                      </span>
                    </td>
                    <td :class="NUMBER">
                      {{ row.reorderLevel ? withUnit(row.reorderLevel, row.unit) : '' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul class="m-0 list-none p-0 md:hidden">
              <li v-for="row in toReorder" :key="row.id" :class="ROW">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    route="items.show"
                    :params="{ id: row.id }"
                    :class="cn(LINK, 'text-[15px] font-semibold')"
                  >
                    {{ row.description }}
                  </Link>
                  <span class="text-[13px] text-muted-foreground">
                    {{
                      [
                        row.code,
                        `${t('ui.items.stock')} ${withUnit(row.inStock, row.unit)}`,
                        `${t('ui.items.committed')} ${withUnit(row.committed, row.unit)}`,
                        row.reorderLevel &&
                          `${t('ui.items.reorderLevel')} ${withUnit(row.reorderLevel, row.unit)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </span>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1">
                  <span class="text-[15px] font-semibold">
                    {{ withUnit(row.available, row.unit) }}
                  </span>
                  <StatusTag tone="orange">{{ reorderLabel(row) }}</StatusTag>
                </div>
              </li>
            </ul>
          </template>
          <p v-else :class="EMPTY">{{ t('ui.stock.nothing') }}</p>
        </ScreenSection>

        <ScreenSection :title="t('ui.stock.belowMarkupTitle')" flush>
          <p :class="DESCRIPTION">{{ t('ui.stock.belowMarkupDescription') }}</p>
          <template v-if="belowMarkup.length">
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full border-collapse" data-testid="below-markup">
                <thead>
                  <tr>
                    <th :class="TH">{{ t('ui.items.code') }}</th>
                    <th :class="TH">{{ t('ui.items.description') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.purchasePrice') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.resalePrice') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.stock.categoryMarkup') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in belowMarkup" :key="row.id">
                    <td :class="cn(TD, 'font-mono whitespace-nowrap')">
                      <Link route="items.show" :params="{ id: row.id }" :class="LINK">
                        {{ row.code }}
                      </Link>
                    </td>
                    <td :class="TD">{{ row.description }}</td>
                    <td :class="NUMBER">{{ formatUnitPrice(row.purchasePrice) }}</td>
                    <td :class="cn(NUMBER, 'font-semibold')">
                      {{ formatUnitPrice(row.resalePrice) }}
                    </td>
                    <td :class="NUMBER">
                      {{ row.markupPercent ? percent(row.markupPercent) : '' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul class="m-0 list-none p-0 md:hidden">
              <li v-for="row in belowMarkup" :key="row.id" :class="ROW">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    route="items.show"
                    :params="{ id: row.id }"
                    :class="cn(LINK, 'text-[15px] font-semibold')"
                  >
                    {{ row.description }}
                  </Link>
                  <span class="text-[13px] text-muted-foreground">
                    {{
                      [
                        row.code,
                        `${t('ui.items.purchasePrice')} ${formatUnitPrice(row.purchasePrice)}`,
                        row.markupPercent &&
                          `${t('ui.stock.categoryMarkup')} ${percent(row.markupPercent)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </span>
                </div>
                <span class="shrink-0 text-[15px] font-semibold">
                  {{ formatUnitPrice(row.resalePrice) }}
                </span>
              </li>
            </ul>
          </template>
          <p v-else :class="EMPTY">{{ t('ui.stock.nothing') }}</p>
        </ScreenSection>
      </div>
    </div>
  </AppLayout>
</template>
