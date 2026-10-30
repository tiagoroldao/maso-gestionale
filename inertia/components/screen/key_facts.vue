<script setup lang="ts">
/**
 * The key-facts band under an Entity screen's header (docs/ui.md "Entity
 * screen body"): the 3–4 facts the user acts on, each a label, a value
 * (a link when it names another record; an amount in large figures) and
 * an optional hint. One row on desktop, a two-column grid on the phone.
 */
import { Link } from '@adonisjs/inertia/vue'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { LABEL } from './screen'

export type KeyFact = {
  label: string
  value: string
  /** The page of the record the value names */
  href?: string
  hint?: string
  /** An amount, shown large */
  amount?: boolean
}

defineProps<{ facts: KeyFact[] }>()
</script>

<template>
  <dl
    :aria-label="t('ui.screen.keyFacts')"
    class="m-0 grid grid-cols-2 rounded-sm border border-border bg-card font-sans text-foreground tabular-nums md:auto-cols-fr md:grid-flow-col md:grid-cols-none"
  >
    <div
      v-for="fact in facts"
      :key="fact.label"
      class="flex min-w-0 flex-col gap-1 border-border px-3.5 py-3 even:border-l nth-[n+3]:border-t md:gap-1.5 md:px-[18px] md:py-3.5 md:not-first:border-l md:nth-[n+3]:border-t-0"
    >
      <dt :class="LABEL">{{ fact.label }}</dt>
      <dd
        :class="
          cn(
            'm-0 font-semibold break-words',
            fact.amount ? 'text-[17px] font-bold md:text-xl' : 'text-sm md:text-[15px]'
          )
        "
      >
        <Link
          v-if="fact.href"
          :href="fact.href"
          class="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {{ fact.value }}
        </Link>
        <template v-else>{{ fact.value }}</template>
      </dd>
      <dd v-if="fact.hint" class="m-0 text-[13px] text-muted-foreground">{{ fact.hint }}</dd>
    </div>
  </dl>
</template>
