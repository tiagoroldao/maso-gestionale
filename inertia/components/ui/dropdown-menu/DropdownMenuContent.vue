<script setup lang="ts">
/**
 * shadcn-vue's dropdown menu, on the Carbonio tokens: a bordered card
 * that floats (so it has the shadow), under its trigger's end.
 */
import type { DropdownMenuContentEmits, DropdownMenuContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from '~/lib/utils'
import { DropdownMenuContent, DropdownMenuPortal, useForwardPropsEmits } from 'reka-ui'

const props = withDefaults(
  defineProps<DropdownMenuContentProps & { class?: HTMLAttributes['class'] }>(),
  { sideOffset: 4, align: 'end' }
)
const emits = defineEmits<DropdownMenuContentEmits>()
const forwarded = useForwardPropsEmits(reactiveOmit(props, 'class'), emits)
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      data-slot="dropdown-menu-content"
      v-bind="forwarded"
      :class="
        cn(
          'z-50 flex max-h-(--reka-dropdown-menu-content-available-height) min-w-56 flex-col overflow-y-auto rounded-sm border border-border bg-popover p-1 font-sans text-popover-foreground shadow-float data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
          props.class
        )
      "
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
