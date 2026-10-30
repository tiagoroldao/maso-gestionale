<script setup lang="ts">
/**
 * A section of an Entity screen (docs/ui.md "Entity screen body"): a flat
 * bordered card named by its label, with its own action (`actions` slot,
 * e.g. "Aggiungi addebito") beside the label. `flush` drops the body's
 * padding, for a table or a list of rows running edge to edge.
 */
import { useId } from 'vue'
import { cn } from '~/lib/utils'
import { LABEL } from './screen'

withDefaults(defineProps<{ title: string; flush?: boolean }>(), { flush: false })
const id = useId()
</script>

<template>
  <section
    :aria-labelledby="id"
    class="min-w-0 rounded-sm border border-border bg-card font-sans text-foreground tabular-nums"
  >
    <div
      class="flex min-h-11 flex-wrap items-center justify-between gap-3 px-3.5 pt-3 pb-2 md:px-4"
    >
      <h2 :id="id" :class="cn(LABEL, 'text-foreground')">{{ title }}</h2>
      <slot name="actions" />
    </div>
    <div :class="flush ? '' : 'flex flex-col gap-3 px-3.5 pb-3.5 md:px-4'">
      <slot />
    </div>
  </section>
</template>
