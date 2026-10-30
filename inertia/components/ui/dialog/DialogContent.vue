<script setup lang="ts">
/**
 * shadcn-vue's dialog content, on the Carbonio tokens: a bordered card
 * over a dimmed screen, with a close button named by `closeLabel`.
 */
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { X } from 'lucide-vue-next'
import { reactiveOmit } from '@vueuse/core'
import { cn } from '~/lib/utils'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { DIALOG_CONTENT, DIALOG_OVERLAY } from '.'

interface Props extends DialogContentProps {
  class?: HTMLAttributes['class']
  /** Name of the close button (from the catalogue) */
  closeLabel: string
}

defineOptions({ inheritAttrs: false })

const props = defineProps<Props>()
const emits = defineEmits<DialogContentEmits>()
const forwarded = useForwardPropsEmits(reactiveOmit(props, 'class', 'closeLabel'), emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay :class="DIALOG_OVERLAY" />
    <DialogContent
      data-slot="dialog-content"
      :class="cn(DIALOG_CONTENT, props.class)"
      v-bind="{ ...$attrs, ...forwarded }"
    >
      <slot />
      <DialogClose
        class="absolute top-3 right-3 grid size-9 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ closeLabel }}</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
