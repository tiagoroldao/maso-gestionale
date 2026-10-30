<script setup lang="ts">
/** A menu item: 36px on desktop, a 44px touch target on the phone */
import type { DropdownMenuItemEmits, DropdownMenuItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from '~/lib/utils'
import { DropdownMenuItem, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<DropdownMenuItemProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DropdownMenuItemEmits>()
const forwarded = useForwardPropsEmits(reactiveOmit(props, 'class'), emits)
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    v-bind="forwarded"
    :class="
      cn(
        'flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-sm px-3 py-1.5 text-left text-[15px] text-foreground outline-none select-none data-disabled:cursor-default data-disabled:text-muted-foreground data-highlighted:bg-background md:min-h-9 md:text-sm',
        props.class
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
