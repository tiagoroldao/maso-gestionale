<script setup lang="ts">
/**
 * A native select, styled as the input (shadcn-vue's native-select): the
 * phone's own picker, which a short list of fixed options needs.
 */
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
const model = defineModel<string>()
</script>

<template>
  <div :class="cn('relative w-full', props.class)">
    <select
      v-model="model"
      v-bind="$attrs"
      data-slot="native-select"
      class="h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-card py-1 pr-9 pl-3 font-sans text-base text-foreground outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:h-9 md:text-sm"
    >
      <slot />
    </select>
    <ChevronDown
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
</template>
