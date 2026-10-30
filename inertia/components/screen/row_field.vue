<script setup lang="ts">
/**
 * A field of a row edited in place (#226), its control in the slot named
 * by its own `aria-label` (the field and the row's record). On the phone,
 * where the rows stack, the field's name shows above it; on desktop the
 * list's column heads (`RowHeads`) say it once.
 */
defineProps<{ label: string }>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <span aria-hidden="true" class="text-xs text-muted-foreground md:hidden">{{ label }}</span>
    <slot />
  </div>
</template>
