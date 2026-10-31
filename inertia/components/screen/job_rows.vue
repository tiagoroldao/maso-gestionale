<script setup lang="ts">
/**
 * Jobs as a table on desktop and a list of rows on the phone, each row
 * opening its Job: the Jobs list's, and the newest Jobs of a Customer or a
 * Site as the body of a flush section (docs/ui.md "Entity screen body"),
 * then a link to all of them on the Jobs list when there are more
 * (`allHref`). Cancelled Jobs are muted; each Job's Quotes show where the
 * list sends them (ADR 0013).
 */
import { computed } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import type { JobIndicators, JobStatus } from '@shared/jobs'
import type { QuoteStatus } from '@shared/quotes'
import { formatDate, t } from '~/i18n'
import { cn } from '~/lib/utils'
import StatusTag from './status_tag.vue'
import { JOB_INDICATOR_TONES, JOB_TONES, LINK, OPENS_LINK, OPENS_ROW, ROW, TD, TH } from './screen'

export type JobRow = {
  id: number
  number: string
  title: string
  status: JobStatus
  // Shown beside the status (ADR 0015)
  indicators: JobIndicators | null
  customer: { id: number; displayName: string } | null
  site: { id: number; summary: string } | null
  createdAt: string
  // Each Quote's number and status, where the list shows them (ADR 0013)
  quotes?: { number: string; status: QuoteStatus }[]
}

const props = defineProps<{
  jobs: JobRow[]
  /** All the record's Jobs, and the Jobs list filtered to them, when only the newest are here */
  total?: number
  allHref?: string
  /** Hidden where the record implies it: the Customer's own page */
  showCustomer?: boolean
  showSite?: boolean
}>()

const showQuotes = computed(() => props.jobs.some((job) => job.quotes))
const indicators = (job: JobRow) =>
  (Object.keys(job.indicators ?? {}) as (keyof JobIndicators)[]).filter(
    (key) => job.indicators?.[key]
  )
const muted = (job: JobRow) => job.status === 'cancelled' && 'text-muted-foreground'
const owner = (job: JobRow) =>
  [props.showCustomer && job.customer?.displayName, props.showSite && job.site?.summary]
    .filter(Boolean)
    .join(' · ')
const quotes = (job: JobRow) =>
  (job.quotes ?? []).map((quote) => `${quote.number} · ${t(`ui.quotes.statuses.${quote.status}`)}`)
</script>

<template>
  <template v-if="jobs.length">
    <div class="hidden overflow-x-auto md:block">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th :class="TH">{{ t('ui.jobs.number') }}</th>
            <th :class="TH">{{ t('ui.jobs.jobTitle') }}</th>
            <th :class="TH">{{ t('ui.jobs.status') }}</th>
            <th v-if="showQuotes" :class="TH">{{ t('ui.jobs.quotes') }}</th>
            <th :class="TH">{{ t('ui.jobs.createdAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id" :class="cn(OPENS_ROW, muted(job))">
            <td :class="cn(TD, 'font-semibold whitespace-nowrap')">
              <Link route="jobs.show" :params="{ id: job.id }" :class="cn(LINK, OPENS_LINK)">
                {{ job.number }}
              </Link>
            </td>
            <td :class="TD">
              {{ job.title }}
              <p v-if="owner(job)" class="m-0 text-[13px] text-muted-foreground">
                {{ owner(job) }}
              </p>
            </td>
            <td :class="TD">
              <span class="flex flex-wrap gap-1.5">
                <StatusTag :tone="JOB_TONES[job.status]">
                  {{ t(`ui.jobs.statuses.${job.status}`) }}
                </StatusTag>
                <StatusTag
                  v-for="key in indicators(job)"
                  :key="key"
                  :tone="JOB_INDICATOR_TONES[key]"
                  data-testid="job-indicator"
                >
                  {{ t(`ui.jobs.indicators.${key}`) }}
                </StatusTag>
              </span>
            </td>
            <td v-if="showQuotes" :class="cn(TD, 'whitespace-nowrap')" data-testid="job-quotes">
              <div v-for="quote in quotes(job)" :key="quote">{{ quote }}</div>
            </td>
            <td :class="cn(TD, 'whitespace-nowrap')">{{ formatDate(job.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="m-0 list-none p-0 md:hidden">
      <li v-for="job in jobs" :key="job.id" :class="cn(ROW, OPENS_ROW, muted(job))">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            route="jobs.show"
            :params="{ id: job.id }"
            :class="cn(LINK, OPENS_LINK, 'text-[15px] font-semibold')"
          >
            {{ job.number }} · {{ job.title }}
          </Link>
          <span class="text-[13px] text-muted-foreground">
            {{ [formatDate(job.createdAt), owner(job)].filter(Boolean).join(' · ') }}
          </span>
          <span v-if="quotes(job).length" class="text-[13px] text-muted-foreground">
            {{ quotes(job).join(', ') }}
          </span>
          <span class="flex flex-wrap gap-1.5">
            <StatusTag :tone="JOB_TONES[job.status]">
              {{ t(`ui.jobs.statuses.${job.status}`) }}
            </StatusTag>
            <StatusTag v-for="key in indicators(job)" :key="key" :tone="JOB_INDICATOR_TONES[key]">
              {{ t(`ui.jobs.indicators.${key}`) }}
            </StatusTag>
          </span>
        </div>
      </li>
    </ul>

    <p
      v-if="allHref && total && total > jobs.length"
      class="m-0 border-t border-border px-3.5 py-3 text-sm md:px-4"
    >
      <Link :href="allHref" :class="LINK">{{ t('ui.jobs.allOf', { total }) }}</Link>
    </p>
  </template>
  <p v-else class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4">
    {{ t('ui.jobs.empty') }}
  </p>
</template>
