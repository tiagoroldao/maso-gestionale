<script setup lang="ts">
/**
 * Switches between light and dark. The theme follows the system setting
 * until the user picks the other one; picking the system's own theme again
 * goes back to following it. `data-theme` on <html> is the theme shown, set
 * before paint by resources/views/inertia_layout.edge.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'
import { t } from '~/i18n'

const COOKIE = 'app_theme'
const ONE_YEAR = 60 * 60 * 24 * 365

const theme = ref<'light' | 'dark'>('light')
let system: MediaQueryList | undefined

function read() {
  theme.value = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

onMounted(() => {
  read()
  // The layout's script switches <html> when the system setting changes
  system = window.matchMedia('(prefers-color-scheme: dark)')
  system.addEventListener('change', read)
})
onBeforeUnmount(() => system?.removeEventListener('change', read))

function toggle() {
  const next = theme.value === 'dark' ? 'light' : 'dark'
  theme.value = next
  document.documentElement.setAttribute('data-theme', next)
  const followsSystem = next === (system?.matches ? 'dark' : 'light')
  document.cookie = followsSystem
    ? `${COOKIE}=; path=/; max-age=0; samesite=lax`
    : `${COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`
}
</script>

<template>
  <button
    type="button"
    class="iconbtn"
    :aria-label="theme === 'dark' ? t('ui.common.lightTheme') : t('ui.common.darkTheme')"
    :title="theme === 'dark' ? t('ui.common.lightTheme') : t('ui.common.darkTheme')"
    @click="toggle"
  >
    <Sun
      :size="16"
      class="themetoggle__icon"
      :class="{ 'themetoggle__icon--on': theme === 'dark' }"
    />
    <Moon
      :size="16"
      class="themetoggle__icon"
      :class="{ 'themetoggle__icon--on': theme !== 'dark' }"
    />
  </button>
</template>
