<script setup lang="ts">
/**
 * The MH mark, traced by hand from the business's JPEG until they supply a
 * vector (docs/follow-ups.md). The letters take the text colour; the cut is
 * brand red, `fill-sidebar-brand` on the black frame. Decorative: the link
 * or text around it names it.
 */
withDefaults(defineProps<{ cutClass?: string }>(), { cutClass: 'fill-brand' })
</script>

<template>
  <svg viewBox="0 0 437 258" fill="currentColor" aria-hidden="true" focusable="false">
    <polygon points="0,2 130,132 197,66 197,127 130,193 44,108 44,258 0,258" />
    <polygon points="220,100 220,48 260,2 260,54" :class="cutClass" />
    <rect x="392" y="0" width="45" height="258" />
    <rect x="262" y="96" width="130" height="44" />
    <polygon points="220,258 220,180 262,140 262,258" />
  </svg>
</template>
