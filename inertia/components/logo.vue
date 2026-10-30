<script setup lang="ts">
/**
 * The MH mark with the wordmark, on the black frame of the screens outside
 * the app shell (sign-in, setup, error pages). In a row; `stacked` puts the
 * wordmark under a larger mark from 768px up, as in the sidebar.
 */
import { Link } from '@adonisjs/inertia/vue'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import LogoMark from '~/components/logo_mark.vue'

defineProps<{ stacked?: boolean }>()
</script>

<template>
  <Link
    href="/"
    :class="
      cn(
        'flex min-h-11 items-center gap-3 rounded-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-brand',
        stacked && 'md:flex-col md:items-start md:gap-2.5'
      )
    "
  >
    <LogoMark
      :class="cn('h-6 w-10 shrink-0', stacked && 'md:h-9 md:w-[61px]')"
      cut-class="fill-sidebar-brand"
    />
    <span
      class="font-display text-[10px] font-semibold tracking-[0.24em] whitespace-nowrap uppercase"
    >
      {{ t('ui.shell.wordmark') }}
    </span>
  </Link>
</template>
