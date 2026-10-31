<script setup lang="ts">
/**
 * A status in a tinted tag (docs/ui.md "Look"): its words in sentence
 * case, the colour only a second cue. A problem (red) also shows an icon,
 * as errors do. Tones per record in `screen.ts`.
 */
import { CircleAlert } from 'lucide-vue-next'
import { cn } from '~/lib/utils'
import type { Tone } from './screen'

defineProps<{ tone: Tone }>()

const TONE_CLASSES: Record<Tone, string> = {
  blue: 'bg-blue-tint text-blue',
  orange: 'bg-orange-tint text-orange',
  green: 'bg-green-tint text-green',
  grey: 'bg-grey-tint text-grey',
  red: 'bg-red-tint text-red',
}
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-2 font-sans text-xs font-semibold whitespace-nowrap',
        TONE_CLASSES[tone]
      )
    "
  >
    <CircleAlert v-if="tone === 'red'" class="size-3.5 shrink-0" aria-hidden="true" />
    <slot />
  </span>
</template>
