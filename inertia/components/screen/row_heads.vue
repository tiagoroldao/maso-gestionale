<script setup lang="ts">
/**
 * The column heads over rows edited in place, on desktop only: each head
 * takes its field's width class, so it sits over its field (`RowField`,
 * which shows the name itself on the phone). Hidden from screen readers,
 * the fields being named by their own labels.
 */
defineProps<{ heads: { label: string; class: string }[] }>()
</script>

<template>
  <div
    aria-hidden="true"
    class="hidden gap-2 border-t border-border px-4 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground md:flex"
  >
    <span v-for="head in heads" :key="head.label" :class="['shrink-0', head.class]">
      {{ head.label }}
    </span>
  </div>
</template>
