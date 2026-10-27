<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import { t } from '~/i18n'

withDefaults(defineProps<{ size?: number }>(), { size: 26 })
</script>

<template>
  <Link
    route="dashboard"
    :aria-label="t('ui.appName')"
    :style="{
      display: 'inline-flex',
      alignItems: 'center',
      color: 'var(--ink)',
      fontWeight: 600,
      fontSize: `${Math.round(size * 0.65)}px`,
      textDecoration: 'none',
    }"
  >
    {{ t('ui.appName') }}
  </Link>
</template>
