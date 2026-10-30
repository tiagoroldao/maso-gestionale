<script setup lang="ts">
/** The dialog's buttons: stacked on the phone, the main one first; in a row from 768px */
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn('flex flex-col-reverse gap-2 md:flex-row md:justify-end', props.class)"
  >
    <slot />
  </div>
</template>
