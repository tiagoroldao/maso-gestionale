<script setup lang="ts">
/**
 * Sign-in and first-run setup, outside the app shell (docs/ui.md "Look").
 * On the phone a black band across the top holds the logo and the theme
 * toggle, with the form below; from 768px up the black frame is a panel
 * on the left, with the tagline, and the form sits on the work surface.
 */
import { t } from '~/i18n'
import Logo from '~/components/logo.vue'
import FlashToasts from '~/components/flash_toasts.vue'
import ThemeToggle from '~/components/theme_toggle.vue'
import { sidebarIconButtonClass } from '~/components/shell_classes'
</script>

<template>
  <div
    class="flex min-h-screen flex-col bg-background font-sans text-foreground tabular-nums md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
  >
    <!-- The black panel runs the page's full height; its content stays in view -->
    <div class="contents md:block md:bg-sidebar">
      <header
        class="sticky top-0 z-40 flex shrink-0 flex-col justify-between bg-sidebar py-1.5 pr-1 pl-4 md:h-screen md:py-8 md:pr-6 md:pl-10 lg:py-10 lg:pl-14"
      >
        <div class="flex items-center justify-between gap-4 md:items-start">
          <Logo stacked />
          <ThemeToggle :class="sidebarIconButtonClass(true)" />
        </div>
        <p
          class="hidden max-w-[22ch] font-display text-2xl leading-snug font-semibold text-balance text-white md:block lg:text-[28px]"
        >
          {{ t('ui.auth.tagline') }}
        </p>
      </header>
    </div>

    <main
      class="flex flex-1 items-start justify-center px-4 pt-8 pb-12 md:items-center md:px-10 md:py-16"
    >
      <div class="w-full max-w-[400px]">
        <slot />
      </div>
    </main>
  </div>
  <FlashToasts />
</template>
