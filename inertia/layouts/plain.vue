<script setup lang="ts">
/**
 * The error pages, outside the app shell (docs/ui.md "Look"): a black band
 * across the top with the logo and the theme toggle, on every screen size,
 * and the page centred on the work surface below.
 */
import Logo from '~/components/logo.vue'
import FlashToasts from '~/components/flash_toasts.vue'
import ThemeToggle from '~/components/theme_toggle.vue'
import { sidebarIconButtonClass } from '~/components/shell_classes'
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background font-sans text-foreground tabular-nums">
    <header
      class="sticky top-0 z-40 flex shrink-0 items-center justify-between gap-4 bg-sidebar py-1.5 pr-1 pl-4 md:pr-4 md:pl-8"
    >
      <Logo />
      <ThemeToggle :class="sidebarIconButtonClass(true)" />
    </header>

    <main
      class="flex flex-1 items-start justify-center px-4 pt-8 pb-12 md:items-center md:px-8 md:py-16"
    >
      <slot />
    </main>
  </div>
  <FlashToasts />
</template>
