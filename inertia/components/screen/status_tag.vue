<script setup lang="ts">
/**
 * A status in a tinted tag (docs/ui.md "Look"): its words in sentence
 * case, the colour only a second cue. Tones per record in `screen.ts`.
 */
import { cn } from '~/lib/utils'
import type { Tone } from './screen'

defineProps<{ tone: Tone }>()

const TONE_CLASSES: Record<Tone, string> = {
  blue: 'bg-blue-tint text-blue',
  orange: 'bg-orange-tint text-orange',
  green: 'bg-green-tint text-green',
  grey: 'bg-grey-tint text-grey',
}
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex h-[22px] shrink-0 items-center rounded-sm px-2 font-sans text-xs font-semibold whitespace-nowrap',
        TONE_CLASSES[tone]
      )
    "
  >
    <slot />
  </span>
</template>
