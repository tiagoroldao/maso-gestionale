<script setup lang="ts">
/**
 * A native select, styled as the input (shadcn-vue's native-select): the
 * phone's own picker, which a short list of fixed options needs.
 *
 * `display`, the chosen option's text, shows it whole, wrapped over lines,
 * where a select's own one line would cut it (long VAT Code names, #266):
 * the select, unseen, lies over it and still takes the clicks and keys.
 */
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ class?: HTMLAttributes['class']; display?: string }>()
const model = defineModel<string>()

const BOX =
  'w-full min-w-0 rounded-md border border-input bg-card pr-9 pl-3 font-sans text-base text-foreground md:text-sm'
</script>

<template>
  <div v-if="display !== undefined" :class="cn('relative w-full', props.class)">
    <select
      v-model="model"
      v-bind="$attrs"
      data-slot="native-select"
      class="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none opacity-0 outline-none disabled:cursor-not-allowed"
    >
      <slot />
    </select>
    <div
      aria-hidden="true"
      :class="
        cn(
          BOX,
          'flex min-h-11 items-center py-2 leading-snug break-words md:min-h-9 md:py-1.5',
          'peer-focus-visible:border-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40 peer-disabled:opacity-50 peer-aria-invalid:border-destructive'
        )
      "
    >
      {{ display }}
    </div>
    <ChevronDown
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
  <div v-else :class="cn('relative w-full', props.class)">
    <select
      v-model="model"
      v-bind="$attrs"
      data-slot="native-select"
      :class="
        cn(
          BOX,
          'h-11 appearance-none py-1 outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:h-9'
        )
      "
    >
      <slot />
    </select>
    <ChevronDown
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
</template>
