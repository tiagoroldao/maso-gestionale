<script setup lang="ts">
/**
 * The newest Jobs of a Customer or a Site, as the body of a flush
 * section (docs/ui.md "Entity screen body"): a table on desktop, a list of
 * rows on the phone, then a link to all of them on the Jobs list when
 * there are more. Cancelled Jobs are muted.
 */
import { Link } from '@adonisjs/inertia/vue'
import type { JobIndicators } from '@shared/jobs'
import type { JobRow } from '~/components/job_list.vue'
import { formatDate, t } from '~/i18n'
import { cn } from '~/lib/utils'
import StatusTag from './status_tag.vue'
import { JOB_INDICATOR_TONES, JOB_TONES, LINK, ROW, TD, TH } from './screen'

defineProps<{
  jobs: JobRow[]
  total: number
  /** The Jobs list, filtered to this record */
  allHref: string
  /** Hidden where the record implies it: the Customer's own page */
  showCustomer?: boolean
  showSite?: boolean
}>()

const indicators = (job: JobRow) =>
  (Object.keys(job.indicators ?? {}) as (keyof JobIndicators)[]).filter(
    (key) => job.indicators?.[key]
  )
const muted = (job: JobRow) => job.status === 'cancelled' && 'text-muted-foreground'
const owner = (job: JobRow, showCustomer: boolean, showSite: boolean) =>
  [showCustomer && job.customer?.displayName, showSite && job.site?.summary]
    .filter(Boolean)
    .join(' · ')
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
            <th :class="TH">{{ t('ui.jobs.createdAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id" :class="muted(job)">
            <td :class="cn(TD, 'font-semibold whitespace-nowrap')">
              <Link route="jobs.show" :params="{ id: job.id }" :class="LINK">
                {{ job.number }}
              </Link>
            </td>
            <td :class="TD">
              {{ job.title }}
              <p
                v-if="owner(job, !!showCustomer, !!showSite)"
                class="m-0 text-[13px] text-muted-foreground"
              >
                {{ owner(job, !!showCustomer, !!showSite) }}
              </p>
            </td>
            <td :class="TD">
              <span class="flex flex-wrap gap-1.5">
                <StatusTag :tone="JOB_TONES[job.status as keyof typeof JOB_TONES] ?? 'grey'">
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
            <td :class="cn(TD, 'whitespace-nowrap')">{{ formatDate(job.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="m-0 list-none p-0 md:hidden">
      <li v-for="job in jobs" :key="job.id" :class="cn(ROW, muted(job))">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            route="jobs.show"
            :params="{ id: job.id }"
            :class="cn(LINK, 'text-[15px] font-semibold')"
          >
            {{ job.number }} · {{ job.title }}
          </Link>
          <span class="text-[13px] text-muted-foreground">
            {{
              [formatDate(job.createdAt), owner(job, !!showCustomer, !!showSite)]
                .filter(Boolean)
                .join(' · ')
            }}
          </span>
          <span class="flex flex-wrap gap-1.5">
            <StatusTag :tone="JOB_TONES[job.status as keyof typeof JOB_TONES] ?? 'grey'">
              {{ t(`ui.jobs.statuses.${job.status}`) }}
            </StatusTag>
            <StatusTag v-for="key in indicators(job)" :key="key" :tone="JOB_INDICATOR_TONES[key]">
              {{ t(`ui.jobs.indicators.${key}`) }}
            </StatusTag>
          </span>
        </div>
      </li>
    </ul>

    <p v-if="total > jobs.length" class="m-0 border-t border-border px-3.5 py-3 text-sm md:px-4">
      <Link :href="allHref" :class="LINK">{{ t('ui.jobs.allOf', { total }) }}</Link>
    </p>
  </template>
  <p v-else class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4">
    {{ t('ui.jobs.empty') }}
  </p>
</template>
