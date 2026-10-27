<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'

withDefaults(defineProps<{ size?: number }>(), { size: 26 })
</script>

<template>
  <Link
    route="dashboard"
    aria-label="Maso Gestionale"
    :style="{
      display: 'inline-flex',
      alignItems: 'center',
      color: 'var(--ink)',
      fontWeight: 600,
      fontSize: `${Math.round(size * 0.65)}px`,
      textDecoration: 'none',
    }"
  >
    Maso Gestionale
  </Link>
</template>
