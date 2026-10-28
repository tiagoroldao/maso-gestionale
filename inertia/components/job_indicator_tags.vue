<script setup lang="ts">
/**
 * The indicators that hold for a Job, shown beside its status (ADR 0015):
 * work complete, invoiced, paid.
 */
import { computed } from 'vue'
import { t } from '~/i18n'
import type { JobIndicators } from '@shared/jobs'

const props = defineProps<{ indicators: JobIndicators }>()
const shown = computed(() =>
  (Object.keys(props.indicators) as (keyof JobIndicators)[]).filter((key) => props.indicators[key])
)
</script>

<template>
  <span v-for="key in shown" :key="key" class="tag" data-testid="job-indicator">
    {{ t(`ui.jobs.indicators.${key}`) }}
  </span>
</template>
